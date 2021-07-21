// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import "./interfaces/IHandler.sol";
import "./interfaces/IYieldAdapter.sol";
import "./libraries/PercentageMath.sol";

contract Symphony is
    Initializable,
    OwnableUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    using SafeERC20 for IERC20;
    using SafeMath for uint256;
    using PercentageMath for uint256;

    struct Order {
        address recipient;
        address inputToken;
        address outputToken;
        uint256 inputAmount;
        uint256 minReturnAmount;
        uint256 stoplossAmount;
        uint256 shares;
    }

    // Protocol treasury address
    address public treasury;

    // Emergency admin address
    address public emergencyAdmin;

    /// Total fee (protocol_fee + relayer_fee)
    uint256 public BASE_FEE; // 1 for 0.01%

    /// Protocol fee: BASE_FEE - RELAYER_FEE
    uint256 public PROTOCOL_FEE_PERCENT;

    mapping(address => address) public strategy;
    mapping(bytes32 => bytes32) public orderHash;
    mapping(address => uint256) public assetBuffer;

    mapping(address => bool) public isRegisteredHandler;
    mapping(address => uint256) public totalAssetShares;
    mapping(address => bool) public isWhitelistedForRewards;

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
    event AddedAssetForReward(address asset);
    event RemovedAssetFromReward(address asset);

    modifier onlyEmergencyAdminOrOwner {
        require(
            _msgSender() == emergencyAdmin || _msgSender() == owner(),
            "Symphony: Only emergency admin or owner can invoke this function"
        );
        _;
    }

    function initialize(
        address _owner,
        address _emergencyAdmin,
        uint256 _baseFee
    ) external initializer {
        BASE_FEE = _baseFee;
        __Ownable_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        super.transferOwnership(_owner);
        emergencyAdmin = _emergencyAdmin;
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
            "Symphony: depositToken:: Input amoount can't be zero"
        );
        require(
            minReturnAmount > 0,
            "Symphony: depositToken:: Amount out can't be zero"
        );
        require(
            stoplossAmount < minReturnAmount,
            "Symphony: depositToken:: StoplossAmount amount should be less than amount out"
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
            orderHash[orderId] == 0x0,
            "Symphony: depositToken:: There is already an existing order with same key"
        );

        uint256 balanceBefore = IERC20(inputToken).balanceOf(address(this));
        IERC20(inputToken).safeTransferFrom(
            msg.sender,
            address(this),
            inputAmount
        );
        require(
            IERC20(inputToken).balanceOf(address(this)) ==
                inputAmount + balanceBefore,
            "Symphony: tokens not transferred"
        );

        uint256 shares = calculateShares(inputToken, inputAmount);

        totalAssetShares[inputToken] = totalAssetShares[inputToken].add(shares);

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

        if (strategy[inputToken] != address(0)) {
            rebalanceAsset(inputToken);
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
            "Symphony: updateOrder:: Order doesn't match"
        );

        Order memory myOrder = decodeOrder(_orderData);

        require(
            msg.sender == myOrder.recipient,
            "Symphony: updateOrder:: Only recipient can update the order"
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
            "Symphony: cancelOrder:: Order doesn't match"
        );

        Order memory myOrder = decodeOrder(_orderData);

        require(
            msg.sender == myOrder.recipient,
            "Symphony: cancelOrder:: Only recipient can cancel the order"
        );

        uint256 totalTokens = getTotalFunds(myOrder.inputToken);

        uint256 bufferAmount = IERC20(myOrder.inputToken).balanceOf(
            address(this)
        );
        uint256 depositPlusYield = calculateTokenFromShares(
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

        calcAndwithdrawFromStrategy(
            myOrder.inputToken,
            depositPlusYield,
            bufferAmount,
            totalTokens,
            myOrder.shares,
            totalSharesInAsset,
            myOrder.recipient,
            bufferAmount < depositPlusYield
        );

        IERC20(myOrder.inputToken).safeTransfer(msg.sender, depositPlusYield);
    }

    /**
     * @notice Execute the order
     */
    function executeOrder(
        bytes32 orderId,
        bytes calldata _orderData,
        address payable _handler,
        bytes memory _handlerData
    ) external nonReentrant whenNotPaused {
        require(
            isRegisteredHandler[_handler],
            "Symphony: executeOrder:: Handler doesn't exists"
        );
        require(
            orderHash[orderId] == keccak256(_orderData),
            "Symphony: executeOrder:: Order doesn't match"
        );

        Order memory myOrder = decodeOrder(_orderData);

        require(
            IHandler(_handler).canHandle(
                myOrder.inputToken,
                myOrder.outputToken,
                myOrder.inputAmount,
                myOrder.minReturnAmount,
                myOrder.stoplossAmount,
                BASE_FEE,
                _handlerData
            ),
            "Symphony: executeOrder:: Handler Can't handle this tx"
        );

        uint256 totalTokens = getTotalFunds(myOrder.inputToken);

        uint256 bufferAmount = IERC20(myOrder.inputToken).balanceOf(
            address(this)
        );

        uint256 depositPlusYield = calculateTokenFromShares(
            myOrder.inputToken,
            myOrder.shares,
            totalTokens
        );

        totalAssetShares[myOrder.inputToken] = totalAssetShares[
            myOrder.inputToken
        ]
        .sub(myOrder.shares);

        delete orderHash[orderId];

        emit OrderExecuted(orderId, msg.sender);

        calcAndwithdrawFromStrategy(
            myOrder.inputToken,
            depositPlusYield,
            bufferAmount,
            totalTokens,
            myOrder.shares,
            totalAssetShares[myOrder.inputToken].add(myOrder.shares), // avoiding stake too deep
            myOrder.recipient,
            bufferAmount < depositPlusYield
        );

        IERC20(myOrder.inputToken).safeTransfer(_handler, depositPlusYield);

        IHandler(_handler).handle(
            myOrder.inputToken,
            myOrder.outputToken,
            depositPlusYield,
            0,
            myOrder.recipient,
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
        address payable _handler,
        bytes memory _handlerData
    ) external nonReentrant whenNotPaused {
        require(
            isRegisteredHandler[_handler],
            "Symphony: fillOrder:: Handler doesn't exists"
        );
        require(
            orderHash[orderId] == keccak256(_orderData),
            "Symphony: fillOrder:: Order doesn't match"
        );

        Order memory myOrder = decodeOrder(_orderData);

        uint256 totalTokens = getTotalFunds(myOrder.inputToken);

        uint256 bufferAmount = IERC20(myOrder.inputToken).balanceOf(
            address(this)
        );

        uint256 depositPlusYield = calculateTokenFromShares(
            myOrder.inputToken,
            myOrder.shares,
            totalTokens
        );

        uint256 totalSharesInAsset = totalAssetShares[myOrder.inputToken];

        totalAssetShares[myOrder.inputToken] = totalSharesInAsset.sub(
            myOrder.shares
        );

        (bool success, uint256 estimatedAmount) = IHandler(_handler).simulate(
            myOrder.inputToken,
            myOrder.outputToken,
            depositPlusYield,
            myOrder.minReturnAmount,
            myOrder.stoplossAmount,
            BASE_FEE,
            _handlerData
        );

        require(
            success,
            "Symphony: fillOrder:: Fill condition doesn't satisfy"
        );

        delete orderHash[orderId];

        emit OrderExecuted(orderId, msg.sender);

        calcAndwithdrawFromStrategy(
            myOrder.inputToken,
            depositPlusYield,
            bufferAmount,
            totalTokens,
            myOrder.shares,
            totalSharesInAsset,
            myOrder.recipient,
            bufferAmount < depositPlusYield
        );

        uint256 totalFee = estimatedAmount.percentMul(BASE_FEE);

        // caution: external calls to unknown address
        IERC20(myOrder.outputToken).safeTransferFrom(
            msg.sender,
            myOrder.recipient,
            estimatedAmount.sub(totalFee)
        );

        if (PROTOCOL_FEE_PERCENT > 0) {
            uint256 protocolFee = estimatedAmount.percentMul(
                PROTOCOL_FEE_PERCENT
            );

            IERC20(myOrder.outputToken).safeTransferFrom(
                msg.sender,
                treasury,
                protocolFee
            );
        }

        IERC20(myOrder.inputToken).safeTransfer(msg.sender, depositPlusYield);
    }

    function rebalanceAsset(address asset) public whenNotPaused {
        require(
            strategy[asset] != address(0),
            "Symphony: rebalanceAsset:: Rebalance needs some strategy"
        );

        uint256 balanceInContract = IERC20(asset).balanceOf(address(this));

        uint256 balanceInStrategy = IYieldAdapter(strategy[asset])
        .getTokensForShares(asset);

        uint256 totalBalance = balanceInContract.add(balanceInStrategy);

        uint256 bufferBalanceNeeded = totalBalance.percentMul(
            assetBuffer[asset]
        );

        require(
            balanceInContract != bufferBalanceNeeded,
            "Symphony: rebalanceAsset:: Asset already balanced"
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
                address(0)
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

    function decodeOrder(bytes memory _data)
        public
        view
        returns (Order memory order)
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

        order = Order(
            recipient,
            inputToken,
            outputToken,
            inputAmount,
            minReturnAmount,
            stoplossAmount,
            shares
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
                IYieldAdapter(strategy[asset]).getTokensForShares(asset)
            );
        }
    }

    // ************************** //
    // *** GOVERNANCE METHODS *** //
    // ************************** //

    /**
     * @notice Pause the contract
     */
    function pause() external onlyEmergencyAdminOrOwner {
        _pause();
    }

    /**
     * @notice Unpause the contract
     */
    function unpause() external onlyEmergencyAdminOrOwner {
        _unpause();
    }

    /**
     * @notice Update emergency admin address
     */
    function updateEmergencyAdmin(address _emergencyAdmin)
        external
        onlyEmergencyAdminOrOwner
    {
        emergencyAdmin = _emergencyAdmin;
    }

    /**
     * @notice Update the treasury address
     */
    function updateTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    /**
     * @notice Update Strategy of a token
     */
    function updateAssetStrategyAndBuffer(
        address _asset,
        address _strategy,
        uint256 _bufferPercent
    ) external onlyOwner {
        address previousStrategy = strategy[_asset];

        strategy[_asset] = _strategy;
        assetBuffer[_asset] = _bufferPercent; // 3000 for 30%;

        // max approve token
        if (
            _strategy != address(0) &&
            IERC20(_asset).allowance(address(this), address(_strategy)) == 0
        ) {
            emit AssetStrategyUpdated(_asset, _strategy);

            // caution: external call to unknown address
            IERC20(_asset).safeApprove(address(_strategy), uint256(-1));
            IYieldAdapter(_strategy).maxApprove(_asset);

            address iouToken = IYieldAdapter(_strategy).getYieldTokenAddress(
                _asset
            );
            IERC20(iouToken).safeApprove(address(_strategy), uint256(-1));

            if (previousStrategy != address(0)) {
                withdrawAllTokensFromStrategy(_asset);
                rebalanceAsset(_asset);
            }
        }
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
     * @notice Update asset buffer percentage
     */
    function updateBufferPercentage(address _asset, uint256 _value)
        external
        onlyOwner
    {
        assetBuffer[_asset] = _value;
        emit UpdatedBufferPercentage(_asset, _value);
    }

    /**
     * @notice Add a token for rewards earning
     */
    function addTokenForReward(address _token) external onlyOwner {
        isWhitelistedForRewards[_token] = true;
        AddedAssetForReward(_token);
    }

    /**
     * @notice Remove a token from rewards earning
     */
    function removeTokenFromReward(address _token) external onlyOwner {
        isWhitelistedForRewards[_token] = false;
        RemovedAssetFromReward(_token);
    }

    /**
     * @notice Withdraw all tokens from strategy
     */
    function withdrawAllTokensFromStrategy(address _asset)
        public
        onlyEmergencyAdminOrOwner
    {
        uint256 amount = IYieldAdapter(strategy[_asset]).getTokensForShares(
            _asset
        );
        uint256 totalSharesInAsset = totalAssetShares[_asset];

        IYieldAdapter(strategy[_asset]).withdraw(
            _asset,
            amount,
            totalSharesInAsset,
            totalSharesInAsset,
            address(this)
        );
    }

    // ************************** //
    // *** INTERNAL FUNCTIONS *** //
    // ************************** //

    function calculateShares(address _token, uint256 _amount)
        internal
        view
        returns (uint256 shares)
    {
        if (totalAssetShares[_token] > 0) {
            shares = _amount.mul(totalAssetShares[_token]).div(
                getTotalFunds(_token)
            );
        } else {
            shares = _amount;
        }
    }

    function calculateTokenFromShares(
        address _token,
        uint256 _shares,
        uint256 totalTokens
    ) internal view returns (uint256 amount) {
        amount = _shares.mul(totalTokens).div(totalAssetShares[_token]);
    }

    function calcAndwithdrawFromStrategy(
        address asset,
        uint256 orderAmount,
        uint256 bufferAmount,
        uint256 totalTokens,
        uint256 orderShare,
        uint256 totalSharesInAsset,
        address recipient,
        bool isWithdrawlRequired
    ) internal {
        uint256 amountToWithdraw = 0;

        if (isWithdrawlRequired) {
            uint256 leftBalanceAfterOrder = totalTokens.sub(orderAmount);

            uint256 neededAmountInBuffer = leftBalanceAfterOrder.percentMul(
                assetBuffer[asset]
            );

            amountToWithdraw = orderAmount.sub(bufferAmount).add(
                neededAmountInBuffer
            );
        }

        emit AssetRebalanced(asset);
        IYieldAdapter(strategy[asset]).withdraw(
            asset,
            amountToWithdraw > 0 ? amountToWithdraw : 0,
            orderShare,
            totalSharesInAsset,
            recipient
        );
    }
}
