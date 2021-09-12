// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "./libraries/PercentageMath.sol";
import "./interfaces/IOracle.sol";
import "./interfaces/IHandler.sol";
import "./interfaces/IYieldAdapter.sol";
import "./interfaces/IOrderStructs.sol";
import "./interfaces/IAaveIncentivesController.sol";

contract Symphony is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using PercentageMath for uint256;

    // Protocol treasury address
    address public treasury;

    // Emergency admin address
    address public emergencyAdmin;

    /// Total fee (protocol_fee + relayer_fee)
    uint256 public BASE_FEE; // 1 for 0.01%

    /// Protocol fee: BASE_FEE - RELAYER_FEE
    uint256 public PROTOCOL_FEE_PERCENT;

    /// Oracle
    IOracle public oracle;

    mapping(address => address) public strategy;
    mapping(bytes32 => bytes32) public orderHash;
    mapping(address => uint256) public assetBuffer;

    mapping(address => bool) public isWhitelistAsset;
    mapping(address => bool) public isRegisteredHandler;
    mapping(address => uint256) public totalAssetShares;

    // ************** //
    // *** EVENTS *** //
    // ************** //
    event AssetRebalanced(address asset);
    event OrderCreated(bytes32 orderId, bytes data);
    event OrderCancelled(bytes32 orderId);
    event OrderExecuted(bytes32 orderId, address executor);
    event OrderUpdated(bytes32 oldOrderId, bytes32 newOrderId, bytes data);
    event AssetStrategyUpdated(address asset, address strategy);
    event HandlerAdded(address handler);
    event HandlerRemoved(address handler);
    event UpdatedBaseFee(uint256 fee);
    event UpdatedBufferPercentage(address asset, uint256 percent);
    event AddedWhitelistAsset(address asset);
    event RemovedWhitelistAsset(address asset);

    modifier onlyEmergencyAdminOrOwner() {
        require(
            _msgSender() == emergencyAdmin || _msgSender() == owner(),
            "Symphony: Only emergency admin or owner can invoke this function"
        );
        _;
    }

    /**
     * @notice To initalize the global variables
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
        uint256 stoplossAmount
    ) external nonReentrant whenNotPaused returns (bytes32 orderId) {
        require(
            inputAmount > 0,
            "Symphony::createOrder: Input amount can't be zero"
        );
        require(
            minReturnAmount > 0,
            "Symphony::createOrder: Amount out can't be zero"
        );
        require(
            isWhitelistAsset[inputToken],
            "Symphony::createOrder: Input asset not in whitelist"
        );
        require(
            stoplossAmount < minReturnAmount,
            "Symphony::createOrder: stoploss amount should be less than amount out"
        );

        orderId = getOrderId(
            recipient,
            inputToken,
            outputToken,
            inputAmount,
            minReturnAmount,
            stoplossAmount
        );

        require(
            orderHash[orderId] == bytes32(0),
            "Symphony::createOrder: There is already an existing order with same id"
        );

        uint256 shares = _calculateShares(inputToken, inputAmount);

        uint256 balanceBefore = IERC20(inputToken).balanceOf(address(this));
        IERC20(inputToken).safeTransferFrom(
            msg.sender,
            address(this),
            inputAmount
        );
        require(
            IERC20(inputToken).balanceOf(address(this)) ==
                inputAmount + balanceBefore,
            "Symphony::createOrder: tokens not transferred"
        );

        uint256 prevTotalAssetShares = totalAssetShares[inputToken];
        totalAssetShares[inputToken] = prevTotalAssetShares.add(shares);

        bytes memory encodedOrder = abi.encode(
            recipient,
            inputToken,
            outputToken,
            inputAmount,
            minReturnAmount,
            stoplossAmount,
            shares
        );

        orderHash[orderId] = keccak256(encodedOrder);

        emit OrderCreated(orderId, encodedOrder);

        address assetStrategy = strategy[inputToken];

        if (assetStrategy != address(0)) {
            rebalanceAsset(inputToken);

            IYieldAdapter(assetStrategy).setOrderRewardDebt(
                orderId,
                inputToken,
                shares,
                prevTotalAssetShares
            );
        }
    }

    /**
     * @notice Update an existing order
     */
    function updateOrder(
        bytes32 orderId,
        bytes calldata _orderData,
        address _receiver,
        address _outputToken,
        uint256 _minReturnAmount,
        uint256 _stoplossAmount
    ) external nonReentrant whenNotPaused {
        require(
            orderHash[orderId] == keccak256(_orderData),
            "Symphony::updateOrder: Order doesn't match"
        );

        IOrderStructs.Order memory myOrder = decodeOrder(_orderData);

        require(
            msg.sender == myOrder.recipient,
            "Symphony::updateOrder: Only recipient can update the order"
        );

        require(
            _minReturnAmount > 0,
            "Symphony::createOrder: Amount out can't be zero"
        );

        require(
            _stoplossAmount < _minReturnAmount,
            "Symphony::createOrder: stoploss amount should be less than amount out"
        );

        delete orderHash[orderId];

        bytes32 newOrderId = getOrderId(
            _receiver,
            myOrder.inputToken,
            _outputToken,
            myOrder.inputAmount,
            _minReturnAmount,
            _stoplossAmount
        );

        require(
            orderHash[newOrderId] == bytes32(0),
            "Symphony::updateOrder: There is already an existing order with same id"
        );

        bytes memory encodedOrder = abi.encode(
            _receiver,
            myOrder.inputToken,
            _outputToken,
            myOrder.inputAmount,
            _minReturnAmount,
            _stoplossAmount,
            myOrder.shares
        );

        orderHash[newOrderId] = keccak256(encodedOrder);

        emit OrderUpdated(orderId, newOrderId, encodedOrder);
    }

    /**
     * @notice Cancel an existing order
     */
    function cancelOrder(bytes32 orderId, bytes calldata _orderData)
        external
        payable
        nonReentrant
    {
        require(
            orderHash[orderId] == keccak256(_orderData),
            "Symphony::cancelOrder: Order doesn't match"
        );

        IOrderStructs.Order memory myOrder = decodeOrder(_orderData);

        require(
            msg.sender == myOrder.recipient,
            "Symphony::cancelOrder: Only recipient can cancel the order"
        );

        uint256 totalTokens = getTotalFunds(myOrder.inputToken);

        uint256 depositPlusYield = _calculateTokenFromShares(
            myOrder.inputToken,
            myOrder.shares,
            totalTokens
        );

        uint256 totalSharesInAsset = totalAssetShares[myOrder.inputToken];

        totalAssetShares[myOrder.inputToken] = totalSharesInAsset.sub(
            myOrder.shares
        );

        delete orderHash[orderId];
        emit OrderCancelled(orderId);

        if (strategy[myOrder.inputToken] != address(0)) {
            _calcAndwithdrawFromStrategy(
                myOrder,
                depositPlusYield,
                totalTokens,
                totalSharesInAsset,
                orderId
            );
        }

        IERC20(myOrder.inputToken).safeTransfer(msg.sender, depositPlusYield);
    }

    /**
     * @notice Execute the order using external DEX
     */
    function executeOrder(
        bytes32 orderId,
        bytes calldata _orderData,
        address payable _handler,
        bytes memory _handlerData
    ) external nonReentrant whenNotPaused {
        require(
            isRegisteredHandler[_handler],
            "Symphony::executeOrder: Handler doesn't exists"
        );
        require(
            orderHash[orderId] == keccak256(_orderData),
            "Symphony::executeOrder: Order doesn't match"
        );

        IOrderStructs.Order memory myOrder = decodeOrder(_orderData);

        uint256 totalTokens = getTotalFunds(myOrder.inputToken);

        uint256 depositPlusYield = _calculateTokenFromShares(
            myOrder.inputToken,
            myOrder.shares,
            totalTokens
        );

        uint256 totalSharesInAsset = totalAssetShares[myOrder.inputToken];

        totalAssetShares[myOrder.inputToken] = totalSharesInAsset.sub(
            myOrder.shares
        );

        delete orderHash[orderId];

        emit OrderExecuted(orderId, msg.sender);

        if (strategy[myOrder.inputToken] != address(0)) {
            _calcAndwithdrawFromStrategy(
                myOrder,
                depositPlusYield,
                totalTokens,
                totalSharesInAsset,
                orderId
            );
        }

        IERC20(myOrder.inputToken).safeTransfer(_handler, depositPlusYield);

        (, uint256 oracleAmount) = oracle.get(
            myOrder.inputToken,
            myOrder.outputToken,
            depositPlusYield
        );

        IHandler(_handler).handle(
            myOrder,
            oracleAmount,
            BASE_FEE,
            PROTOCOL_FEE_PERCENT,
            msg.sender,
            treasury,
            _handlerData
        );
    }

    /**
     * @notice Fill an order with own liquidity
     */
    function fillOrder(
        bytes32 orderId,
        bytes calldata _orderData,
        uint256 quoteAmount
    ) external nonReentrant whenNotPaused {
        require(
            orderHash[orderId] == keccak256(_orderData),
            "Symphony::fillOrder: Order doesn't match"
        );

        IOrderStructs.Order memory myOrder = decodeOrder(_orderData);

        uint256 totalTokens = getTotalFunds(myOrder.inputToken);

        uint256 depositPlusYield = _calculateTokenFromShares(
            myOrder.inputToken,
            myOrder.shares,
            totalTokens
        );

        uint256 totalSharesInAsset = totalAssetShares[myOrder.inputToken];

        totalAssetShares[myOrder.inputToken] = totalSharesInAsset.sub(
            myOrder.shares
        );

        (uint256 oracleAmount, ) = oracle.get(
            myOrder.inputToken,
            myOrder.outputToken,
            depositPlusYield
        );

        bool success = ((quoteAmount >= myOrder.minReturnAmount ||
            quoteAmount <= myOrder.stoplossAmount) &&
            quoteAmount >= oracleAmount);

        require(success, "Symphony::fillOrder: Fill condition doesn't satisfy");

        delete orderHash[orderId];

        emit OrderExecuted(orderId, msg.sender);

        if (strategy[myOrder.inputToken] != address(0)) {
            _calcAndwithdrawFromStrategy(
                myOrder,
                depositPlusYield,
                totalTokens,
                totalSharesInAsset,
                orderId
            );
        }

        uint256 totalFee = quoteAmount.percentMul(BASE_FEE);

        // caution: external calls to unknown address
        IERC20(myOrder.outputToken).safeTransferFrom(
            msg.sender,
            myOrder.recipient,
            quoteAmount.sub(totalFee)
        );

        if (PROTOCOL_FEE_PERCENT > 0 && treasury != address(0)) {
            uint256 protocolFee = totalFee.percentMul(PROTOCOL_FEE_PERCENT);

            IERC20(myOrder.outputToken).safeTransferFrom(
                msg.sender,
                treasury,
                protocolFee
            );
        }

        IERC20(myOrder.inputToken).safeTransfer(msg.sender, depositPlusYield);
    }

    /**
     * @notice rebalance asset according to buffer percent
     */
    function rebalanceAsset(address asset) public whenNotPaused {
        require(
            strategy[asset] != address(0),
            "Symphony::rebalanceAsset: Rebalance needs some strategy"
        );

        uint256 balanceInContract = IERC20(asset).balanceOf(address(this));

        uint256 balanceInStrategy = IYieldAdapter(strategy[asset])
            .getTotalUnderlying(asset);

        uint256 totalBalance = balanceInContract.add(balanceInStrategy);

        uint256 bufferBalanceNeeded = totalBalance.percentMul(
            assetBuffer[asset]
        );

        emit AssetRebalanced(asset);

        if (balanceInContract > bufferBalanceNeeded) {
            IYieldAdapter(strategy[asset]).deposit(
                asset,
                balanceInContract.sub(bufferBalanceNeeded)
            );
        } else if (balanceInContract < bufferBalanceNeeded) {
            IYieldAdapter(strategy[asset]).withdraw(
                asset,
                bufferBalanceNeeded.sub(balanceInContract),
                0,
                0,
                address(0),
                bytes32(0)
            );
        }
    }

    // *************** //
    // *** GETTERS *** //
    // *************** //

    function getOrderId(
        address _recipient,
        address _inputToken,
        address _outputToken,
        uint256 _amount,
        uint256 _minReturnAmount,
        uint256 _stoplossAmount
    ) public pure returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    _recipient,
                    _inputToken,
                    _outputToken,
                    _amount,
                    _minReturnAmount,
                    _stoplossAmount
                )
            );
    }

    function getTotalFunds(address asset)
        public
        view
        returns (uint256 totalBalance)
    {
        totalBalance = IERC20(asset).balanceOf(address(this));

        if (strategy[asset] != address(0)) {
            totalBalance = totalBalance.add(
                IYieldAdapter(strategy[asset]).getTotalUnderlying(asset)
            );
        }
    }

    function decodeOrder(bytes memory _data)
        public
        view
        returns (IOrderStructs.Order memory order)
    {
        (
            address recipient,
            address inputToken,
            address outputToken,
            uint256 inputAmount,
            uint256 minReturnAmount,
            uint256 stoplossAmount,
            uint256 shares
        ) = abi.decode(
                _data,
                (address, address, address, uint256, uint256, uint256, uint256)
            );

        order = IOrderStructs.Order(
            recipient,
            inputToken,
            outputToken,
            inputAmount,
            minReturnAmount,
            stoplossAmount,
            shares
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
        isRegisteredHandler[_handler] = true;
        emit HandlerAdded(_handler);
    }

    /**
     * @notice Remove an order handler
     */
    function removeHandler(address _handler) external onlyOwner {
        isRegisteredHandler[_handler] = false;
        emit HandlerRemoved(_handler);
    }

    /**
     * @notice Update base execution fee
     */
    function updateBaseFee(uint256 _fee) external onlyOwner {
        BASE_FEE = _fee;
        emit UpdatedBaseFee(_fee);
    }

    /**
     * @notice Update protocol fee
     */
    function updateProtocolFee(uint256 _feePercent) external onlyOwner {
        PROTOCOL_FEE_PERCENT = _feePercent;
    }

    /**
     * @notice Update the oracle
     */
    function updateOracle(IOracle _oracle) external onlyOwner {
        oracle = _oracle;
    }

    /**
     * @notice Add an asset into whitelist
     */
    function addWhitelistAsset(address _asset) external onlyOwner {
        isWhitelistAsset[_asset] = true;
        AddedWhitelistAsset(_asset);
    }

    /**
     * @notice Remove a whitelisted asset
     */
    function removeWhitelistAsset(address _asset) external onlyOwner {
        isWhitelistAsset[_asset] = false;
        RemovedWhitelistAsset(_asset);
    }

    /**
     * @notice Update strategy
     */
    function updateStrategy(address _asset, address _strategy)
        external
        onlyOwner
    {
        require(
            strategy[_asset] != _strategy,
            "Symphony::updateStrategy: Strategy shouldn't be same."
        );
        _updateAssetStrategy(_asset, _strategy);
    }

    /**
     * @notice Withdraw tokens from contract
     */
    function withdrawTokens(
        address[] calldata assets,
        uint256[] calldata amount,
        address receiver
    ) external onlyOwner {
        for (uint256 i = 0; i < assets.length; i++) {
            IERC20(assets[i]).safeTransfer(receiver, amount[i]);
        }
    }

    /**
     * @notice Migrate to new strategy
     */
    function migrateStrategy(
        address asset,
        address newStrategy,
        bytes calldata data
    ) external onlyOwner {
        address previousStrategy = strategy[asset];
        require(
            previousStrategy != address(0),
            "Symphony::migrateStrategy: no strategy for asset exists!!"
        );
        require(
            previousStrategy != newStrategy,
            "Symphony::migrateStrategy: new startegy shouldn't be same!!"
        );

        IYieldAdapter(previousStrategy).withdrawAll(asset, data);

        if (newStrategy != address(0)) {
            _updateAssetStrategy(asset, newStrategy);
        } else {
            strategy[asset] = newStrategy;
        }
    }

    /**
     * @notice For executing any transaction from the contract
     */
    function executeTransaction(
        address target,
        uint256 value,
        string memory signature,
        bytes memory data
    ) external payable onlyOwner returns (bytes memory) {
        bytes memory callData;

        if (bytes(signature).length == 0) {
            callData = data;
        } else {
            callData = abi.encodePacked(
                bytes4(keccak256(bytes(signature))),
                data
            );
        }

        // solium-disable-next-line security/no-call-value
        (bool success, bytes memory returnData) = target.call{value: value}(
            callData
        );

        require(
            success,
            "Symphony::executeTransaction: Transaction execution reverted."
        );

        return returnData;
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

    /*symphony*
     * @notice Unpause the contract
     */
    function unpause() external onlyEmergencyAdminOrOwner {
        _unpause();
    }

    /**
     * @notice Withdraw all assets from strategies including rewards
     * @dev Only in emergency case. Transfer rewards to symphony contract
     */
    function emergencyWithdrawFromStrategy(
        address[] calldata assets,
        bytes calldata data
    ) external onlyEmergencyAdminOrOwner {
        for (uint256 i = 0; i < assets.length; i++) {
            address asset = assets[i];
            address assetStrategy = strategy[asset];

            IYieldAdapter(assetStrategy).withdrawAll(asset, data);
        }
    }

    /**
     * @notice Update asset buffer percentage
     */
    function updateBufferPercentage(address _asset, uint256 _value)
        external
        onlyEmergencyAdminOrOwner
    {
        require(
            _value <= 10000,
            "symphony::updateBufferPercentage: not correct buffer percent."
        );
        assetBuffer[_asset] = _value;
        emit UpdatedBufferPercentage(_asset, _value);
        rebalanceAsset(_asset);
    }

    /**
     * @notice Update emergency admin address
     */
    function updateEmergencyAdmin(address _emergencyAdmin) external {
        require(
            _msgSender() == emergencyAdmin,
            "Symphony: Only emergency admin can invoke this function"
        );
        emergencyAdmin = _emergencyAdmin;
    }

    // ************************** //
    // *** INTERNAL FUNCTIONS *** //
    // ************************** //

    function _calculateShares(address _token, uint256 _amount)
        internal
        view
        returns (uint256 shares)
    {
        if (totalAssetShares[_token] > 0) {
            shares = _amount.mul(totalAssetShares[_token]).div(
                getTotalFunds(_token)
            );
            require(
                shares > 0,
                "Symphony::_calculateShares: shares can't be 0"
            );
        } else {
            shares = _amount;
        }
    }

    function _calculateTokenFromShares(
        address _token,
        uint256 _shares,
        uint256 totalTokens
    ) internal view returns (uint256 amount) {
        amount = _shares.mul(totalTokens).div(totalAssetShares[_token]);
    }

    function _calcAndwithdrawFromStrategy(
        IOrderStructs.Order memory myOrder,
        uint256 orderAmount,
        uint256 totalTokens,
        uint256 totalSharesInAsset,
        bytes32 orderId
    ) internal {
        address asset = myOrder.inputToken;
        uint256 leftBalanceAfterOrder = totalTokens.sub(orderAmount);

        uint256 neededAmountInBuffer = leftBalanceAfterOrder.percentMul(
            assetBuffer[asset]
        );

        uint256 bufferAmount = IERC20(asset).balanceOf(address(this));

        uint256 amountToWithdraw = 0;
        if (bufferAmount < orderAmount.add(neededAmountInBuffer)) {
            amountToWithdraw = orderAmount.add(neededAmountInBuffer).sub(
                bufferAmount
            );
        }

        emit AssetRebalanced(asset);

        IYieldAdapter(strategy[asset]).withdraw(
            asset,
            amountToWithdraw,
            myOrder.shares,
            totalSharesInAsset,
            myOrder.recipient,
            orderId
        );
    }

    /**
     * @notice Update Strategy of an asset
     */
    function _updateAssetStrategy(address _asset, address _strategy) internal {
        // max approve token
        if (
            _strategy != address(0) &&
            IERC20(_asset).allowance(address(this), _strategy) == 0
        ) {
            emit AssetStrategyUpdated(_asset, _strategy);

            // caution: external call to unknown address
            IERC20(_asset).safeApprove(_strategy, uint256(-1));
            IYieldAdapter(_strategy).maxApprove(_asset);

            strategy[_asset] = _strategy;
            rebalanceAsset(_asset);
        }
    }
}
