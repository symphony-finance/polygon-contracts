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
    uint256 public baseFeePercent; // 1 for 0.01%

    /// Protocol fee: base_fee_percent - relayer_fee
    uint256 public protocolFeePercent;

    /// Cancellation fee: x% of total yield
    uint256 public cancellationFeePercent; // 1 for 0.01%

    /// Oracle
    IOracle public oracle;

    // Wrapped MATIC token address
    address internal constant WMATIC =
        0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270;

    mapping(address => address) public strategy;
    mapping(bytes32 => bytes32) public orderHash;
    mapping(address => uint256) public tokenBuffer;

    mapping(address => bool) public whitelistedTokens;
    mapping(address => uint256) public totalTokenShares;
    mapping(address => bool) public allowedHandlers;
    mapping(address => mapping(address => bool)) public allowedExecutors;

    // ************** //
    // *** EVENTS *** //
    // ************** //
    event OrderCreated(bytes32 orderId, bytes data);
    event OrderCancelled(bytes32 orderId, uint256 amountReceived);
    event OrderExecuted(
        bytes32 orderId,
        uint256 amountReceived,
        uint256 depositPlusYield
    );
    event OrderUpdated(bytes32 oldOrderId, bytes32 newOrderId, bytes data);
    event TokenStrategyUpdated(address token, address strategy);
    event HandlerAdded(address handler);
    event HandlerRemoved(address handler);
    event BaseFeeUpdated(uint256 feePercent);
    event ProtocolFeeUpdated(uint256 feePercent);
    event CancellationFeeUpdated(uint256 feePercent);
    event TokenBufferUpdated(address token, uint256 bufferPercent);
    event AddedWhitelistToken(address token);
    event RemovedWhitelistToken(address token);
    event OracleAddressUpdated(address oracle);
    event EmergencyAdminUpdated(address admin);
    event TokensRebalanced(uint256 txCost);

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
        uint256 _baseFeePercent,
        IOracle _oracle
    ) external initializer {
        baseFeePercent = _baseFeePercent;
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
            "Yolo::createOrder: unsupported input token"
        );
        require(
            recipient != address(0),
            "Yolo::createOrder: zero recipient address"
        );
        require(inputAmount > 0, "Yolo::createOrder: zero input amount");
        require(minReturnAmount > 0, "Yolo::createOrder: zero return amount");
        require(
            stoplossAmount < minReturnAmount,
            "Yolo::createOrder: stoploss amount greater than return amount"
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
            "Yolo::createOrder: order already exists with the same id"
        );

        uint256 prevTotalShares = totalTokenShares[inputToken];

        uint256 shares = inputAmount;
        address tokenStrategy = strategy[inputToken];
        if (prevTotalShares > 0) {
            uint256 prevTotalTokens = IERC20(inputToken).balanceOf(
                address(this)
            );

            if (tokenStrategy != address(0)) {
                prevTotalTokens = getTotalTokens(
                    inputToken,
                    prevTotalTokens,
                    tokenStrategy
                );
            }

            shares = (inputAmount * prevTotalShares) / prevTotalTokens;
            require(shares > 0, "Yolo::createOrder: shares can't be zero");
        }

        // caution: trusting user input
        IERC20(inputToken).safeTransferFrom(
            msg.sender,
            address(this),
            inputAmount
        );

        totalTokenShares[inputToken] = prevTotalShares + shares;

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

        if (tokenStrategy != address(0)) {
            address[] memory tokens = new address[](1);
            tokens[0] = inputToken;
            rebalanceTokens(tokens);
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
            "Yolo::createNativeOrder: zero recipient address"
        );
        require(inputAmount > 0, "Yolo::createNativeOrder: zero input amount");
        require(
            minReturnAmount > 0,
            "Yolo::createNativeOrder: zero return amount"
        );
        require(
            stoplossAmount < minReturnAmount,
            "Yolo::createNativeOrder: stoploss amount greater than return amount"
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
            "Yolo::createNativeOrder: order already exists with the same id"
        );

        uint256 prevTotalShares = totalTokenShares[inputToken];

        uint256 shares = inputAmount;
        address tokenStrategy = strategy[inputToken];
        if (prevTotalShares > 0) {
            uint256 prevTotalTokens = IERC20(inputToken).balanceOf(
                address(this)
            );

            if (tokenStrategy != address(0)) {
                prevTotalTokens = getTotalTokens(
                    inputToken,
                    prevTotalTokens,
                    tokenStrategy
                );
            }

            shares = (inputAmount * prevTotalShares) / prevTotalTokens;
            require(
                shares > 0,
                "Yolo::createNativeOrder: shares can't be zero"
            );
        }

        IWMATIC(inputToken).deposit{value: inputAmount}();

        totalTokenShares[inputToken] = prevTotalShares + shares;

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

        if (tokenStrategy != address(0)) {
            address[] memory tokens = new address[](1);
            tokens[0] = inputToken;
            rebalanceTokens(tokens);
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
            "Yolo::updateOrder: zero recipient address"
        );
        require(
            orderHash[orderId] == keccak256(orderData),
            "Yolo::updateOrder: order doesn't match"
        );

        IOrderStructs.Order memory myOrder = decodeOrder(orderData);

        require(
            msg.sender == myOrder.creator,
            "Yolo::updateOrder: only creator can update the order"
        );
        require(minReturnAmount > 0, "Yolo::updateOrder: zero return amount");
        require(
            stoplossAmount < minReturnAmount,
            "Yolo::updateOrder: stoploss amount greater than return amount"
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
            "Yolo::updateOrder: order already exists with the same id"
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
            "Yolo::cancelOrder: order doesn't match"
        );

        IOrderStructs.Order memory myOrder = decodeOrder(orderData);

        require(
            msg.sender == myOrder.creator,
            "Yolo::cancelOrder: only creator can cancel the order"
        );

        depositPlusYield = _removeOrder(
            orderId,
            myOrder.inputToken,
            myOrder.shares
        );

        uint256 cancellationFee = 0;
        uint256 feePercent = cancellationFeePercent;
        if (depositPlusYield > myOrder.inputAmount && feePercent > 0) {
            uint256 yieldEarned = depositPlusYield - myOrder.inputAmount;
            cancellationFee = yieldEarned.percentMul(feePercent);
            if (cancellationFee > 0) {
                IERC20(myOrder.inputToken).safeTransfer(
                    treasury,
                    cancellationFee
                );
            }
        }

        uint256 transferAmount = depositPlusYield - cancellationFee;
        IERC20(myOrder.inputToken).safeTransfer(msg.sender, transferAmount);
        emit OrderCancelled(orderId, transferAmount);
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
            "Yolo::executeOrder: order doesn't match"
        );

        IOrderStructs.Order memory myOrder = decodeOrder(orderData);

        if (myOrder.executor != address(0) && myOrder.executor != msg.sender) {
            require(
                allowedExecutors[myOrder.executor][msg.sender],
                "Yolo::executeOrder: order executor mismatch"
            );
        }
        require(
            allowedHandlers[handler],
            "Yolo::executeOrder: unregistered handler"
        );

        uint256 depositPlusYield = _removeOrder(
            orderId,
            myOrder.inputToken,
            myOrder.shares
        );
        if (depositPlusYield < myOrder.inputAmount) {
            myOrder.inputAmount = depositPlusYield;
        }

        uint256 totalFee = _getTotalFee(myOrder.inputAmount);
        if (totalFee > 0) {
            _transferFee(myOrder.inputToken, totalFee, msg.sender);
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
            "Yolo::fillOrder: order doesn't match"
        );

        IOrderStructs.Order memory myOrder = decodeOrder(orderData);

        if (myOrder.executor != address(0) && myOrder.executor != msg.sender) {
            require(
                allowedExecutors[myOrder.executor][msg.sender],
                "Yolo::fillOrder: order executor mismatch"
            );
        }

        uint256 depositPlusYield = _removeOrder(
            orderId,
            myOrder.inputToken,
            myOrder.shares
        );
        if (depositPlusYield < myOrder.inputAmount) {
            myOrder.inputAmount = depositPlusYield;
        }

        uint256 totalFee = _getTotalFee(myOrder.inputAmount);

        (uint256 oracleAmount, ) = oracle.get(
            myOrder.inputToken,
            myOrder.outputToken,
            myOrder.inputAmount - totalFee
        );

        bool success = ((quoteAmount >= myOrder.minReturnAmount ||
            quoteAmount <= myOrder.stoplossAmount) &&
            quoteAmount >= oracleAmount);

        require(success, "Yolo::fillOrder: fill condition doesn't satisfy");

        emit OrderExecuted(orderId, quoteAmount, depositPlusYield);

        uint256 protocolFee = 0;
        if (totalFee > 0) {
            protocolFee = _transferFee(
                myOrder.inputToken,
                totalFee,
                address(0)
            );
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
     * @notice rebalance token according to buffer
     */
    function rebalanceTokens(address[] memory tokens) public {
        uint256 totalGas = gasleft();
        for (uint256 i = 0; i < tokens.length; i++) {
            address tokenStrategy = strategy[tokens[i]];
            require(
                tokenStrategy != address(0),
                "Yolo::rebalanceTokens: strategy doesn't exist"
            );

            uint256 balanceInContract = IERC20(tokens[i]).balanceOf(
                address(this)
            );

            uint256 balanceInStrategy = IYieldAdapter(tokenStrategy)
                .getTotalUnderlying(tokens[i]);

            uint256 totalBalance = balanceInContract + balanceInStrategy;

            uint256 bufferBalanceNeeded = totalBalance.percentMul(
                tokenBuffer[tokens[i]]
            );

            if (balanceInContract > bufferBalanceNeeded) {
                uint256 depositAmount = balanceInContract - bufferBalanceNeeded;
                IERC20(tokens[i]).safeTransfer(tokenStrategy, depositAmount);
                IYieldAdapter(tokenStrategy).deposit(tokens[i], depositAmount);
            } else if (balanceInContract < bufferBalanceNeeded) {
                IYieldAdapter(tokenStrategy).withdraw(
                    tokens[i],
                    bufferBalanceNeeded - balanceInContract
                );
            }
            if (i == tokens.length - 1) {
                emit TokensRebalanced((totalGas - gasleft()) * tx.gasprice);
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

    function getTotalTokens(
        address token,
        uint256 contractBalance,
        address tokenStrategy
    ) public returns (uint256 totalTokens) {
        totalTokens = contractBalance;
        if (tokenStrategy != address(0)) {
            totalTokens =
                totalTokens +
                IYieldAdapter(tokenStrategy).getTotalUnderlying(token);
        }
    }

    function decodeOrder(bytes memory orderData)
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
                orderData,
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
     * @notice Update base execution fee oercent
     */
    function updateBaseFee(uint256 _feePercent) external onlyOwner {
        require(
            _feePercent < 10000,
            "Yolo::updateBaseFee: fee percent exceeds max threshold"
        );
        baseFeePercent = _feePercent;
        emit BaseFeeUpdated(_feePercent);
    }

    /**
     * @notice Update protocol fee percent
     */
    function updateProtocolFee(uint256 _feePercent) external onlyOwner {
        require(
            _feePercent <= 10000,
            "Yolo::updateProtocolFee: fee percent exceeds max threshold"
        );
        protocolFeePercent = _feePercent;
        emit ProtocolFeeUpdated(_feePercent);
    }

    /**
     * @notice Update cancellation fee percent
     */
    function updateCancellationFee(uint256 _feePercent) external onlyOwner {
        require(
            _feePercent <= 10000,
            "Yolo::updateCancellationFee: fee percent exceeds max threshold"
        );
        cancellationFeePercent = _feePercent;
        emit CancellationFeeUpdated(_feePercent);
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
     * @notice Add an token into whitelist
     */
    function addWhitelistToken(address _token) external onlyOwner {
        whitelistedTokens[_token] = true;
        emit AddedWhitelistToken(_token);
    }

    /**
     * @notice Remove a whitelisted token
     */
    function removeWhitelistToken(address _token) external onlyOwner {
        whitelistedTokens[_token] = false;
        emit RemovedWhitelistToken(_token);
    }

    /**
     * @notice Set strategy of an token
     */
    function setStrategy(address _token, address _strategy) external onlyOwner {
        require(
            strategy[_token] == address(0),
            "Yolo::setStrategy: strategy already exists"
        );
        _updateTokenStrategy(_token, _strategy);
    }

    /**
     * @notice Migrate to new strategy
     */
    function migrateStrategy(address _token, address _newStrategy)
        external
        onlyOwner
    {
        address previousStrategy = strategy[_token];
        require(
            previousStrategy != address(0),
            "Yolo::migrateStrategy: no previous strategy exists"
        );
        require(
            previousStrategy != _newStrategy,
            "Yolo::migrateStrategy: new strategy same as previous"
        );

        IYieldAdapter(previousStrategy).withdrawAll(_token);

        require(
            IYieldAdapter(previousStrategy).getTotalUnderlying(_token) == 0,
            "Yolo::migrateStrategy: withdraw from strategy failed"
        );

        if (_newStrategy != address(0)) {
            _updateTokenStrategy(_token, _newStrategy);
        } else {
            strategy[_token] = _newStrategy;
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
     * @notice Withdraw all tokens from strategies including rewards
     * @dev Only in emergency case. Transfer rewards to Yolo contract
     */
    function emergencyWithdrawFromStrategy(address[] calldata _tokens)
        external
        onlyEmergencyAdminOrOwner
    {
        for (uint256 i = 0; i < _tokens.length; i++) {
            address token = _tokens[i];
            address tokenStrategy = strategy[token];

            IYieldAdapter(tokenStrategy).withdrawAll(token);
        }
    }

    /**
     * @notice Update token buffer percent
     */
    function updateTokenBuffer(address _token, uint256 _bufferPercent)
        external
        onlyEmergencyAdminOrOwner
    {
        require(
            _bufferPercent <= 10000,
            "Yolo::updateTokenBuffer: buffer percent exceeds max threshold"
        );
        tokenBuffer[_token] = _bufferPercent;
        emit TokenBufferUpdated(_token, _bufferPercent);
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
     * @notice Update Strategy of an token
     */
    function _updateTokenStrategy(address _token, address _strategy) internal {
        if (_strategy != address(0)) {
            emit TokenStrategyUpdated(_token, _strategy);
            strategy[_token] = _strategy;
            address[] memory tokens = new address[](1);
            tokens[0] = _token;
            rebalanceTokens(tokens);
        }
    }

    function _getTotalFee(uint256 _amount)
        internal
        view
        returns (uint256 totalFee)
    {
        totalFee = _amount.percentMul(baseFeePercent);
    }

    function _transferFee(
        address _token,
        uint256 _totalFee,
        address _executor
    ) internal returns (uint256 protocolFee) {
        address treasuryAddress = treasury;
        uint256 _protocolFeePercent = protocolFeePercent;

        if (treasuryAddress != address(0) && _protocolFeePercent > 0) {
            protocolFee = _totalFee.percentMul(_protocolFeePercent);
            IERC20(_token).safeTransfer(treasuryAddress, protocolFee);
        }

        if (_executor != address(0) && protocolFee < _totalFee) {
            IERC20(_token).safeTransfer(_executor, _totalFee - protocolFee);
        }
    }

    function _removeOrder(
        bytes32 _orderId,
        address _token,
        uint256 _shares
    ) internal returns (uint256 depositPlusYield) {
        delete orderHash[_orderId];
        address tokenStrategy = strategy[_token];
        uint256 contractBal = IERC20(_token).balanceOf(address(this));
        uint256 totalTokens = getTotalTokens(
            _token,
            contractBal,
            tokenStrategy
        );
        uint256 totalShares = totalTokenShares[_token];
        totalTokenShares[_token] = totalShares - _shares;
        depositPlusYield = (_shares * totalTokens) / (totalShares);

        if (contractBal < depositPlusYield && tokenStrategy != address(0)) {
            uint256 neededAmountInBuffer = (totalTokens - depositPlusYield)
                .percentMul(tokenBuffer[_token]);

            IYieldAdapter(tokenStrategy).withdraw(
                _token,
                depositPlusYield + neededAmountInBuffer - contractBal
            );
        }
    }
}
