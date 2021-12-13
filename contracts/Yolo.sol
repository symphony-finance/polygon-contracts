// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";

import "./libraries/PercentageMath.sol";
import "./interfaces/IOracle.sol";
import "./interfaces/IHandler.sol";
import "./interfaces/IYieldAdapter.sol";
import "./interfaces/IOrderStructs.sol";
import {IWETH as IWMATIC} from "./interfaces/IWETH.sol";

/**
 * @title Yolo contract
 * @author Symphony Finance
 **/
contract Yolo is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;
    using PercentageMath for uint256;

    // Protocol treasury address
    address public treasury;

    // Emergency admin address
    address public emergencyAdmin;

    /// Total fee (protocol_fee + relayer_fee)
    uint256 public BASE_FEE; // 1 for 0.01%

    /// Protocol fee: BASE_FEE - RELAYER_FEE
    uint256 public PROTOCOL_FEE_PERCENT;

    /// Cancellation fee: x% of total yield
    uint256 public CANCELLATION_FEE_PERCENT; // 1 for 0.01%

    /// Oracle
    IOracle public oracle;

    // Wrapped WMATIC token
    address internal constant WMATIC =
        0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270;

    mapping(address => address) public strategy;
    mapping(bytes32 => bytes32) public orderHash;
    mapping(address => uint256) public assetBuffer;

    mapping(address => bool) public whitelistedTokens;
    mapping(address => bool) public allowedHandlers;
    mapping(address => uint256) public totalAssetShares;
    mapping(address => mapping(address => bool)) public allowedExecutors;

    // ************** //
    // *** EVENTS *** //
    // ************** //
    event OrderCreated(bytes32 orderId, bytes data);
    event OrderCancelled(bytes32 orderId, uint256 depositPlusYield);
    event OrderExecuted(
        bytes32 orderId,
        uint256 totalAmountOut,
        uint256 depositPlusYield
    );
    event OrderUpdated(bytes32 oldOrderId, bytes32 newOrderId, bytes data);
    event AssetStrategyUpdated(address asset, address strategy);
    event HandlerAdded(address handler);
    event HandlerRemoved(address handler);
    event UpdatedBaseFee(uint256 fee);
    event ProtocolFeeUpdated(uint256 fee);
    event UpdatedBufferPercentage(address asset, uint256 percent);
    event AddedWhitelistAsset(address asset);
    event RemovedWhitelistAsset(address asset);
    event OracleAddressUpdated(address oracle);
    event EmergencyWithdraw(address asset);
    event EmergencyAdminUpdated(address emergenycyAdmin);
    event AssetsRebalanced(uint256 txCost);

    modifier onlyEmergencyAdminOrOwner() {
        require(
            _msgSender() == emergencyAdmin || _msgSender() == owner(),
            "Yolo: Only emergency admin or owner can invoke this function"
        );
        _;
    }

    /**
     * @notice To initialize the global variables
     */
    function initialize(
        address _owner,
        address _emergencyAdmin,
        uint256 _baseFee,
        IOracle _oracle
    ) external initializer {
        BASE_FEE = _baseFee;
        __Ownable_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        super.transferOwnership(_owner);
        emergencyAdmin = _emergencyAdmin;
        oracle = _oracle;
    }

    /**
     * @notice Create an order
     */
    function createOrder(
        address recipient,
        address inputToken,
        address outputToken,
        uint256 inputAmount,
        uint256 minReturnAmount,
        uint256 stoplossAmount,
        address executor
    )
        external
        nonReentrant
        whenNotPaused
        returns (bytes32 orderId, bytes memory orderData)
    {
        require(
            whitelistedTokens[inputToken],
            "Yolo::createOrder: Input asset not in whitelist"
        );
        require(
            recipient != address(0),
            "Yolo::createOrder: Recipient shouldn't be zero address"
        );
        require(
            inputAmount > 0,
            "Yolo::createOrder: Input amount can't be zero"
        );
        require(
            minReturnAmount > 0,
            "Yolo::createOrder: Amount out can't be zero"
        );
        require(
            stoplossAmount < minReturnAmount,
            "Yolo::createOrder: stoploss amount should be less than amount out"
        );

        orderId = getOrderId(
            msg.sender,
            recipient,
            inputToken,
            outputToken,
            inputAmount,
            minReturnAmount,
            stoplossAmount,
            executor,
            block.timestamp
        );

        require(
            orderHash[orderId] == bytes32(0),
            "Yolo::createOrder: There is already an existing order with same id"
        );

        uint256 previousTotalShares = totalAssetShares[inputToken];

        uint256 shares = inputAmount;
        address assetStrategy = strategy[inputToken];
        if (previousTotalShares > 0) {
            uint256 previousTotalTokens = IERC20(inputToken).balanceOf(
                address(this)
            );

            if (assetStrategy != address(0)) {
                previousTotalTokens = getTotalFunds(
                    inputToken,
                    previousTotalTokens,
                    assetStrategy
                );
            }

            shares = (inputAmount * previousTotalShares) / previousTotalTokens;
            require(shares > 0, "Yolo::createOrder: shares can't be 0");
        }

        // caution: trusting user input
        IERC20(inputToken).safeTransferFrom(
            msg.sender,
            address(this),
            inputAmount
        );

        totalAssetShares[inputToken] = previousTotalShares + shares;

        orderData = abi.encode(
            msg.sender,
            recipient,
            inputToken,
            outputToken,
            inputAmount,
            minReturnAmount,
            stoplossAmount,
            shares,
            executor
        );

        orderHash[orderId] = keccak256(orderData);

        emit OrderCreated(orderId, orderData);

        if (assetStrategy != address(0)) {
            address[] memory assets = new address[](1);
            assets[0] = inputToken;
            rebalanceAssets(assets);
        }
    }

    /**
     * @notice Create MATIC order
     */
    function createNativeOrder(
        address recipient,
        address outputToken,
        uint256 minReturnAmount,
        uint256 stoplossAmount,
        address executor
    )
        external
        payable
        nonReentrant
        whenNotPaused
        returns (bytes32 orderId, bytes memory orderData)
    {
        uint256 inputAmount = msg.value;
        address inputToken = WMATIC;

        require(
            recipient != address(0),
            "Yolo::createWmaticOrder: Recipient shouldn't be zero address"
        );
        require(
            inputAmount > 0,
            "Yolo::createWmaticOrder: Input amount can't be zero"
        );
        require(
            minReturnAmount > 0,
            "Yolo::createWmaticOrder: Amount out can't be zero"
        );
        require(
            stoplossAmount < minReturnAmount,
            "Yolo::createWmaticOrder: stoploss amount should be less than amount out"
        );

        orderId = getOrderId(
            msg.sender,
            recipient,
            inputToken,
            outputToken,
            inputAmount,
            minReturnAmount,
            stoplossAmount,
            executor,
            block.timestamp
        );

        require(
            orderHash[orderId] == bytes32(0),
            "Yolo::createWmaticOrder: There is already an existing order with same id"
        );

        uint256 previousTotalShares = totalAssetShares[inputToken];

        uint256 shares = inputAmount;
        address assetStrategy = strategy[inputToken];
        if (previousTotalShares > 0) {
            uint256 previousTotalTokens = IERC20(inputToken).balanceOf(
                address(this)
            );

            if (assetStrategy != address(0)) {
                previousTotalTokens = getTotalFunds(
                    inputToken,
                    previousTotalTokens,
                    assetStrategy
                );
            }

            shares = (inputAmount * previousTotalShares) / previousTotalTokens;
            require(shares > 0, "Yolo::createWmaticOrder: shares can't be 0");
        }

        IWMATIC(inputToken).deposit{value: inputAmount}();

        totalAssetShares[inputToken] = previousTotalShares + shares;

        orderData = abi.encode(
            msg.sender,
            recipient,
            inputToken,
            outputToken,
            inputAmount,
            minReturnAmount,
            stoplossAmount,
            shares,
            executor
        );

        orderHash[orderId] = keccak256(orderData);

        emit OrderCreated(orderId, orderData);

        if (assetStrategy != address(0)) {
            address[] memory assets = new address[](1);
            assets[0] = inputToken;
            rebalanceAssets(assets);
        }
    }

    /**
     * @notice Update an existing order
     */
    function updateOrder(
        bytes32 orderId,
        bytes calldata orderData,
        address recipient,
        address outputToken,
        uint256 minReturnAmount,
        uint256 stoplossAmount,
        address executor
    )
        external
        nonReentrant
        whenNotPaused
        returns (bytes32 newOrderId, bytes memory newOrderData)
    {
        require(
            recipient != address(0),
            "Yolo::updateOrder: Recipient shouldn't be zero address"
        );
        require(
            orderHash[orderId] == keccak256(orderData),
            "Yolo::updateOrder: Order doesn't match"
        );

        IOrderStructs.Order memory myOrder = decodeOrder(orderData);

        require(
            msg.sender == myOrder.creator,
            "Yolo::updateOrder: Only creator can update the order"
        );
        require(
            minReturnAmount > 0,
            "Yolo::updateOrder: Amount out can't be zero"
        );
        require(
            stoplossAmount < minReturnAmount,
            "Yolo::updateOrder: stoploss amount should be less than amount out"
        );

        delete orderHash[orderId];

        newOrderId = getOrderId(
            msg.sender,
            recipient,
            myOrder.inputToken,
            outputToken,
            myOrder.inputAmount,
            minReturnAmount,
            stoplossAmount,
            executor,
            block.timestamp
        );

        require(
            orderHash[newOrderId] == bytes32(0),
            "Yolo::updateOrder: There is already an existing order with same id"
        );

        newOrderData = abi.encode(
            msg.sender,
            recipient,
            myOrder.inputToken,
            outputToken,
            myOrder.inputAmount,
            minReturnAmount,
            stoplossAmount,
            myOrder.shares,
            executor
        );

        orderHash[newOrderId] = keccak256(newOrderData);

        emit OrderUpdated(orderId, newOrderId, newOrderData);
    }

    /**
     * @notice Cancel an existing order
     */
    function cancelOrder(bytes32 orderId, bytes calldata orderData)
        external
        nonReentrant
        returns (uint256 depositPlusYield)
    {
        require(
            orderHash[orderId] == keccak256(orderData),
            "Yolo::cancelOrder: Order doesn't match"
        );

        IOrderStructs.Order memory myOrder = decodeOrder(orderData);

        require(
            msg.sender == myOrder.creator,
            "Yolo::cancelOrder: Only creator can cancel the order"
        );

        depositPlusYield = removeOrder(
            orderId,
            myOrder.inputToken,
            myOrder.shares
        );

        uint256 cancellationFee = 0;
        uint256 cancellationFeePercent = CANCELLATION_FEE_PERCENT;
        if (
            depositPlusYield > myOrder.inputAmount && cancellationFeePercent > 0
        ) {
            uint256 yieldEarned = depositPlusYield - myOrder.inputAmount;
            cancellationFee = yieldEarned.percentMul(cancellationFeePercent);
            if (cancellationFee > 0) {
                IERC20(myOrder.inputToken).safeTransfer(
                    treasury,
                    cancellationFee
                );
            }
        }

        uint256 transferAmount = depositPlusYield - cancellationFee;
        emit OrderCancelled(orderId, transferAmount);
        IERC20(myOrder.inputToken).safeTransfer(msg.sender, transferAmount);
    }

    /**
     * @notice Execute the order using external DEX
     */
    function executeOrder(
        bytes32 orderId,
        bytes calldata orderData,
        address payable handler,
        bytes calldata handlerData
    ) external nonReentrant whenNotPaused {
        require(
            orderHash[orderId] == keccak256(orderData),
            "Yolo::executeOrder: Order doesn't match"
        );

        IOrderStructs.Order memory myOrder = decodeOrder(orderData);

        if (myOrder.executor != address(0) && myOrder.executor != msg.sender) {
            require(
                allowedExecutors[myOrder.executor][msg.sender],
                "Yolo::executeOrder: Order executor mismatch"
            );
        }

        require(
            allowedHandlers[handler],
            "Yolo::executeOrder: Not registered handler"
        );

        uint256 depositPlusYield = removeOrder(
            orderId,
            myOrder.inputToken,
            myOrder.shares
        );
        if (depositPlusYield < myOrder.inputAmount) {
            myOrder.inputAmount = depositPlusYield;
        }

        uint256 totalFee = getTotalFee(myOrder.inputAmount);
        if (totalFee > 0) {
            transferFee(myOrder.inputToken, totalFee, msg.sender);
        }

        myOrder.inputAmount = myOrder.inputAmount - totalFee;

        (, uint256 oracleAmount) = oracle.get(
            myOrder.inputToken,
            myOrder.outputToken,
            myOrder.inputAmount
        );

        IERC20(myOrder.inputToken).safeTransfer(handler, myOrder.inputAmount);

        uint256 totalAmountOut = IHandler(handler).handle(
            myOrder,
            oracleAmount,
            handlerData
        );

        emit OrderExecuted(orderId, totalAmountOut, depositPlusYield);

        depositPlusYield = depositPlusYield - totalFee;
        if (depositPlusYield > myOrder.inputAmount) {
            uint256 yieldEarned = depositPlusYield - myOrder.inputAmount;
            IERC20(myOrder.inputToken).safeTransfer(
                myOrder.recipient,
                yieldEarned
            );
        }
    }

    /**
     * @notice Fill an order with own liquidity
     */
    function fillOrder(
        bytes32 orderId,
        bytes calldata orderData,
        uint256 quoteAmount
    ) external nonReentrant whenNotPaused {
        require(
            orderHash[orderId] == keccak256(orderData),
            "Yolo::fillOrder: Order doesn't match"
        );

        IOrderStructs.Order memory myOrder = decodeOrder(orderData);

        if (myOrder.executor != address(0) && myOrder.executor != msg.sender) {
            require(
                allowedExecutors[myOrder.executor][msg.sender],
                "Yolo::fillOrder: Order executor mismatch"
            );
        }

        uint256 depositPlusYield = removeOrder(
            orderId,
            myOrder.inputToken,
            myOrder.shares
        );
        if (depositPlusYield < myOrder.inputAmount) {
            myOrder.inputAmount = depositPlusYield;
        }

        uint256 totalFee = getTotalFee(myOrder.inputAmount);

        (uint256 oracleAmount, ) = oracle.get(
            myOrder.inputToken,
            myOrder.outputToken,
            myOrder.inputAmount - totalFee
        );

        bool success = ((quoteAmount >= myOrder.minReturnAmount ||
            quoteAmount <= myOrder.stoplossAmount) &&
            quoteAmount >= oracleAmount);

        require(success, "Yolo::fillOrder: Fill condition doesn't satisfy");

        emit OrderExecuted(orderId, quoteAmount, depositPlusYield);

        uint256 protocolFee = 0;
        if (totalFee > 0) {
            protocolFee = transferFee(myOrder.inputToken, totalFee, address(0));
        }

        // caution: external calls to unknown address
        IERC20(myOrder.outputToken).safeTransferFrom(
            msg.sender,
            myOrder.recipient,
            quoteAmount
        );

        IERC20(myOrder.inputToken).safeTransfer(
            msg.sender,
            myOrder.inputAmount - protocolFee
        );

        if (depositPlusYield > myOrder.inputAmount) {
            uint256 yieldEarned = depositPlusYield - myOrder.inputAmount;
            IERC20(myOrder.inputToken).safeTransfer(
                myOrder.recipient,
                yieldEarned
            );
        }
    }

    /**
     * @notice rebalance asset according to buffer percent
     */
    function rebalanceAssets(address[] memory assets) public {
        uint256 totalGas = gasleft();
        for (uint256 i = 0; i < assets.length; i++) {
            address assetStrategy = strategy[assets[i]];
            require(
                assetStrategy != address(0),
                "Yolo::rebalanceAsset: Rebalance needs some strategy"
            );

            uint256 balanceInContract = IERC20(assets[i]).balanceOf(
                address(this)
            );

            uint256 balanceInStrategy = IYieldAdapter(assetStrategy)
                .getTotalUnderlying(assets[i]);

            uint256 totalBalance = balanceInContract + balanceInStrategy;

            uint256 bufferBalanceNeeded = totalBalance.percentMul(
                assetBuffer[assets[i]]
            );

            if (balanceInContract > bufferBalanceNeeded) {
                uint256 depositAmount = balanceInContract - bufferBalanceNeeded;
                IERC20(assets[i]).safeTransfer(assetStrategy, depositAmount);
                IYieldAdapter(assetStrategy).deposit(assets[i], depositAmount);
            } else if (balanceInContract < bufferBalanceNeeded) {
                IYieldAdapter(assetStrategy).withdraw(
                    assets[i],
                    bufferBalanceNeeded - balanceInContract
                );
            }
            if (i == assets.length - 1) {
                emit AssetsRebalanced((totalGas - gasleft()) * tx.gasprice);
            }
        }
    }

    // *************** //
    // *** GETTERS *** //
    // *************** //

    function getOrderId(
        address creator,
        address recipient,
        address inputToken,
        address outputToken,
        uint256 amount,
        uint256 minReturnAmount,
        uint256 stoplossAmount,
        address executor,
        uint256 blockTimestamp
    ) public view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    creator,
                    recipient,
                    inputToken,
                    outputToken,
                    amount,
                    minReturnAmount,
                    stoplossAmount,
                    executor,
                    blockTimestamp
                )
            );
    }

    function getTotalFunds(
        address asset,
        uint256 contractBalance,
        address assetStrategy
    ) public returns (uint256 totalBalance) {
        totalBalance = contractBalance;
        if (assetStrategy != address(0)) {
            totalBalance =
                totalBalance +
                IYieldAdapter(assetStrategy).getTotalUnderlying(asset);
        }
    }

    function decodeOrder(bytes memory _data)
        public
        view
        returns (IOrderStructs.Order memory order)
    {
        (
            address creator,
            address recipient,
            address inputToken,
            address outputToken,
            uint256 inputAmount,
            uint256 minReturnAmount,
            uint256 stoplossAmount,
            uint256 shares,
            address executor
        ) = abi.decode(
                _data,
                (
                    address,
                    address,
                    address,
                    address,
                    uint256,
                    uint256,
                    uint256,
                    uint256,
                    address
                )
            );

        order = IOrderStructs.Order(
            creator,
            recipient,
            inputToken,
            outputToken,
            inputAmount,
            minReturnAmount,
            stoplossAmount,
            shares,
            executor
        );
    }

    // ************************** //
    // *** GOVERNANCE METHODS *** //
    // ************************** //

    /**
     * @notice Update the treasury address
     */
    function updateTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    /**
     * @notice Add an order handler
     */
    function addHandler(address _handler) external onlyOwner {
        allowedHandlers[_handler] = true;
        emit HandlerAdded(_handler);
    }

    /**
     * @notice Remove an order handler
     */
    function removeHandler(address _handler) external onlyOwner {
        allowedHandlers[_handler] = false;
        emit HandlerRemoved(_handler);
    }

    /**
     * @notice Update base execution fee
     */
    function updateBaseFee(uint256 _fee) external onlyOwner {
        require(
            _fee < 10000,
            "Yolo::updateBaseFee: value should be less than 10000"
        );
        BASE_FEE = _fee;
        emit UpdatedBaseFee(_fee);
    }

    /**
     * @notice Update protocol fee percent
     */
    function updateProtocolFee(uint256 _feePercent) external onlyOwner {
        require(
            _feePercent <= 10000,
            "Yolo::updateProtocolFee: value exceeds max threshold of 10000"
        );
        PROTOCOL_FEE_PERCENT = _feePercent;
        emit ProtocolFeeUpdated(_feePercent);
    }

    /**
     * @notice Update cancellation fee percent
     */
    function updateCancellationFee(uint256 _feePercent) external onlyOwner {
        require(
            _feePercent <= 10000,
            "Yolo::updateCancellationFee: value exceeds max threshold of 10000"
        );
        CANCELLATION_FEE_PERCENT = _feePercent;
    }

    /**
     * @notice Update the oracle
     */
    function updateOracle(IOracle _oracle) external onlyOwner {
        require(
            IOracle(_oracle).isOracle(),
            "Yolo::updateOracle: invalid oracle address"
        );
        oracle = _oracle;
        emit OracleAddressUpdated(address(_oracle));
    }

    /**
     * @notice Add an asset into whitelist
     */
    function addWhitelistAsset(address _asset) external onlyOwner {
        whitelistedTokens[_asset] = true;
        emit AddedWhitelistAsset(_asset);
    }

    /**
     * @notice Remove a whitelisted asset
     */
    function removeWhitelistAsset(address _asset) external onlyOwner {
        whitelistedTokens[_asset] = false;
        emit RemovedWhitelistAsset(_asset);
    }

    /**
     * @notice set strategy of an asset
     */
    function setStrategy(address _asset, address _strategy) external onlyOwner {
        require(
            strategy[_asset] == address(0),
            "Yolo::setStrategy: Strategy already exists"
        );
        _updateAssetStrategy(_asset, _strategy);
    }

    /**
     * @notice Migrate to new strategy
     */
    function migrateStrategy(address asset, address newStrategy)
        external
        onlyOwner
    {
        address previousStrategy = strategy[asset];
        require(
            previousStrategy != address(0),
            "Yolo::migrateStrategy: no strategy for asset exists"
        );
        require(
            previousStrategy != newStrategy,
            "Yolo::migrateStrategy: new strategy shouldn't be same"
        );

        IYieldAdapter(previousStrategy).withdrawAll(asset);

        require(
            IYieldAdapter(previousStrategy).getTotalUnderlying(asset) == 0,
            "Yolo::migrateStrategy: strategy withdrawAll failed"
        );

        if (newStrategy != address(0)) {
            _updateAssetStrategy(asset, newStrategy);
        } else {
            strategy[asset] = newStrategy;
        }
    }

    // *************************** //
    // **** EMERGENCY METHODS **** //
    // *************************** //

    /**
     * @notice Pause the contract
     */
    function pause() external onlyEmergencyAdminOrOwner {
        _pause();
    }

    /*Yolo*
     * @notice Unpause the contract
     */
    function unpause() external onlyEmergencyAdminOrOwner {
        _unpause();
    }

    /**
     * @notice Withdraw all assets from strategies including rewards
     * @dev Only in emergency case. Transfer rewards to Yolo contract
     */
    function emergencyWithdrawFromStrategy(address[] calldata assets)
        external
        onlyEmergencyAdminOrOwner
    {
        for (uint256 i = 0; i < assets.length; i++) {
            address asset = assets[i];
            address assetStrategy = strategy[asset];

            IYieldAdapter(assetStrategy).withdrawAll(asset);
            emit EmergencyWithdraw(asset);
        }
    }

    /**
     * @notice Update asset buffer percentage
     */
    function updateBufferPercentage(address asset, uint256 value)
        external
        onlyEmergencyAdminOrOwner
    {
        require(
            value <= 10000,
            "Yolo::updateBufferPercentage: not correct buffer percent."
        );
        assetBuffer[asset] = value;
        emit UpdatedBufferPercentage(asset, value);
    }

    /**
     * @notice Update emergency admin address
     */
    function updateEmergencyAdmin(address _emergencyAdmin)
        external
        onlyEmergencyAdminOrOwner
    {
        emergencyAdmin = _emergencyAdmin;
        emit EmergencyAdminUpdated(_emergencyAdmin);
    }

    // ************************** //
    // *** EXECUTOR FUNCTIONS *** //
    // ************************** //
    function approveExecutor(address executor) external {
        allowedExecutors[msg.sender][executor] = true;
    }

    function revokeExecutor(address executor) external {
        allowedExecutors[msg.sender][executor] = false;
    }

    // ************************** //
    // *** INTERNAL FUNCTIONS *** //
    // ************************** //

    /**
     * @notice Update Strategy of an asset
     */
    function _updateAssetStrategy(address _asset, address _strategy) internal {
        if (_strategy != address(0)) {
            emit AssetStrategyUpdated(_asset, _strategy);
            strategy[_asset] = _strategy;
            address[] memory assets = new address[](1);
            assets[0] = _asset;
            rebalanceAssets(assets);
        }
    }

    function getTotalFee(uint256 _amount)
        internal
        view
        returns (uint256 totalFee)
    {
        totalFee = _amount.percentMul(BASE_FEE);
    }

    function transferFee(
        address token,
        uint256 totalFee,
        address executor
    ) internal returns (uint256 protocolFee) {
        address treasuryAddress = treasury;
        uint256 protocolFeePercent = PROTOCOL_FEE_PERCENT;

        if (treasuryAddress != address(0) && protocolFeePercent > 0) {
            protocolFee = totalFee.percentMul(protocolFeePercent);
            IERC20(token).safeTransfer(treasuryAddress, protocolFee);
        }

        if (executor != address(0) && protocolFee < totalFee) {
            IERC20(token).safeTransfer(executor, totalFee - protocolFee);
        }
    }

    function removeOrder(
        bytes32 orderId,
        address inputToken,
        uint256 shares
    ) internal returns (uint256 depositPlusYield) {
        delete orderHash[orderId];
        address assetStrategy = strategy[inputToken];
        uint256 contractBal = IERC20(inputToken).balanceOf(address(this));
        uint256 totalTokens = getTotalFunds(
            inputToken,
            contractBal,
            assetStrategy
        );
        uint256 totalShares = totalAssetShares[inputToken];
        totalAssetShares[inputToken] = totalShares - shares;
        depositPlusYield = (shares * totalTokens) / (totalShares);

        if (contractBal < depositPlusYield && assetStrategy != address(0)) {
            uint256 neededAmountInBuffer = (totalTokens - depositPlusYield)
                .percentMul(assetBuffer[inputToken]);

            IYieldAdapter(assetStrategy).withdraw(
                inputToken,
                depositPlusYield + neededAmountInBuffer - contractBal
            );
        }
    }
}
