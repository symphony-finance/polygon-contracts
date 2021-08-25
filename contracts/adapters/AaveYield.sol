// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";

import "../interfaces/IYieldAdapter.sol";
import "../interfaces/IAaveToken.sol";
import "../interfaces/IAaveLendingPool.sol";
import "../interfaces/IAavePoolCore.sol";
import "../interfaces/IAaveIncentivesController.sol";

/**
 * @title Aave Yield contract
 * @notice Implements the functions to deposit/withdraw into Aave
 * @author Symphony Finance
 **/
contract AaveYield is IYieldAdapter, Initializable {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    // Addresses related to aave
    address public lendingPool;
    address public protocolDataProvider;
    IAaveIncentivesController public incentivesController;

    address public symphony;
    address public governance;
    address public REWARD_TOKEN;
    uint16 public referralCode;
    bool public isExternalRewardEnabled;

    mapping(bytes32 => uint256) public orderRewardDebt;
    mapping(address => uint256) public pendingRewards;
    mapping(address => uint256) public previousAccRewardPerShare;
    mapping(address => uint256) public userReward;

    modifier onlySymphony() {
        require(
            msg.sender == symphony,
            "AaveYield: Only symphony contract can invoke this function"
        );
        _;
    }

    modifier onlyGovernance() {
        require(
            msg.sender == governance,
            "YearnYield: Only governance contract can invoke this function"
        );
        _;
    }

    /**
     * @dev To initialize the contract addresses interacting with this contract
     * @param _lendingPool the address of LendingPool
     * @param _protocolDataProvider the address of ProtocolDataProvider
     **/
    function initialize(
        address _symphony,
        address _governance,
        address _lendingPool,
        address _protocolDataProvider,
        address _incentivesController
    ) external initializer {
        require(_symphony != address(0), "AaveYield: Symphony:: zero address");
        require(
            _governance != address(0),
            "AaveYield: Governance:: zero address"
        );
        require(
            _protocolDataProvider != address(0),
            "AaveYield: protocolDataProvider:: zero address"
        );
        require(
            _lendingPool != address(0),
            "AaveYield: lendingPool:: zero address"
        );

        symphony = _symphony;
        governance = _governance;
        lendingPool = _lendingPool;
        protocolDataProvider = _protocolDataProvider;
        incentivesController = IAaveIncentivesController(_incentivesController);
        isExternalRewardEnabled = true;
        REWARD_TOKEN = incentivesController.REWARD_TOKEN();
    }

    /**
     * @dev Used to deposit tokens in available protocol
     * @param asset the address of token to invest
     * @param amount the amount of asset
     **/
    function deposit(address asset, uint256 amount)
        external
        override
        onlySymphony
    {
        require(amount != 0, "AaveYield::deposit: zero amount");

        emit Deposit(asset, amount);

        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);
        _depositERC20(asset, amount);
    }

    /**
     * @dev Used to withdraw tokens from available protocol
     **/
    function withdraw(
        address asset,
        uint256 amount,
        uint256 shares,
        uint256 totalShares,
        address recipient,
        bytes32 orderId
    ) external override onlySymphony {
        if (amount > 0) {
            emit Withdraw(asset, amount);

            uint256 underlyingAssetAmt = _withdrawERC20(asset, amount);

            require(
                underlyingAssetAmt > 0,
                "AaveYield::withdraw: incorrect amount withdrawn"
            );
        }

        if (isExternalRewardEnabled && shares > 0 && recipient != address(0)) {
            _calculateAndStoreReward(
                asset,
                shares,
                totalShares,
                orderRewardDebt[orderId],
                recipient
            );
        }
    }

    /**
     * @dev Withdraw all tokens from the strategy
     * @param asset the address of token
     **/
    function withdrawAll(address asset) external override onlySymphony {
        address aToken = _getATokenAddress(asset);

        uint256 amount = IERC20(aToken).balanceOf(address(this));

        if (amount > 0) {
            _withdrawERC20(asset, amount);
        }
    }

    /**
     * @notice Withdraw WMATIC reward from Aave
     * @param _asset underlying asset address
     * @param _amount Amount to withdraw (check using getRewardsBalance)
     */
    function withdrawAaveReward(address _asset, uint256 _amount) external {
        address aToken = _getATokenAddress(_asset);

        address[] memory assets = new address[](1);
        assets[0] = aToken;

        uint256 returnAmount = incentivesController.claimRewards(
            assets,
            _amount,
            address(this)
        );

        if (returnAmount > 0) {
            _updatePendingReward(_asset, returnAmount);
        }
    }

    /**
     * @dev Used to set external reward debt at the time of order creation
     * @param orderId the id of the order
     * @param asset the address of token
     **/
    function setOrderRewardDebt(
        bytes32 orderId,
        address asset,
        uint256 shares,
        uint256 totalShares
    ) external override onlySymphony {
        uint256 orderDebt;
        uint256 totalRewardBalance = getRewardBalance(asset);

        if (totalRewardBalance > 0 && totalShares > 0) {
            uint256 accRewardPerShare = getAccumulatedRewardPerShare(
                asset,
                totalShares,
                totalRewardBalance
            );
            orderDebt = calculateOrderDebt(shares, accRewardPerShare);

            pendingRewards[asset] = totalRewardBalance;
            previousAccRewardPerShare[asset] = accRewardPerShare;
        }

        orderRewardDebt[orderId] = orderDebt;
    }

    /**
     * @dev Used to approve max token from yield provider contract
     * @param asset the address of token
     **/
    function maxApprove(address asset) external override {
        address aToken = _getATokenAddress(asset);
        IERC20(asset).safeApprove(lendingPool, uint256(-1));
        IERC20(aToken).safeApprove(lendingPool, uint256(-1));
    }

    /**
     * @dev Used to claim reward
     **/
    function claimReward(uint256 amount) external {
        require(
            amount <= userReward[msg.sender],
            "AaveYield::claimReward: Amount shouldn't execeed total reward"
        );

        userReward[msg.sender] = userReward[msg.sender].sub(amount);
        IERC20(REWARD_TOKEN).safeTransfer(msg.sender, amount);
    }

    // *************** //
    // *** GETTERS *** //
    // *************** //

    /**
     * @dev Used to get amount of underlying tokens
     * @param asset the address of asset
     * @return amount amount of underlying tokens
     **/
    function getTotalUnderlying(address asset)
        public
        view
        override
        returns (uint256 amount)
    {
        address aToken = _getATokenAddress(asset);

        amount = IERC20(aToken).balanceOf(address(this));
    }

    /**
     * @dev Used to get IOU token address
     * @param asset the address of token
     * @return iouToken address of IOU token
     **/
    function getYieldTokenAddress(address asset)
        external
        view
        override
        returns (address iouToken)
    {
        (iouToken, , ) = IAavePoolCore(protocolDataProvider)
            .getReserveTokensAddresses(asset);
    }

    /**
     * @dev Used to get asset external reward balance
     **/
    function getRewardBalance(address asset)
        public
        view
        returns (uint256 amount)
    {
        if (isExternalRewardEnabled) {
            address aToken = _getATokenAddress(asset);
            address[] memory assets = new address[](1);
            assets[0] = aToken;

            amount = incentivesController.getRewardsBalance(
                assets,
                address(this)
            );
        }
    }

    function getAccumulatedRewardPerShare(
        address asset,
        uint256 totalShares,
        uint256 rewardBalance
    ) public view returns (uint256 result) {
        // ARPS = previous_APRS + (new_reward / total_shares)
        uint256 newReward = rewardBalance.sub(pendingRewards[asset]);

        // ARPS stored in 10^18 denomination.
        uint256 newRewardPerShare = newReward.mul(10**18).div(totalShares);
        result = previousAccRewardPerShare[asset].add(newRewardPerShare);
    }

    function calculateOrderDebt(uint256 shares, uint256 accRewardPerShare)
        public
        view
        returns (uint256 rewardDebt)
    {
        rewardDebt = shares.mul(accRewardPerShare).div(10**18);
    }

    // ************************** //
    // *** GOVERNANCE METHODS *** //
    // ************************** //

    function updateReferralCode(uint16 _referralCode) external onlyGovernance {
        referralCode = _referralCode;
    }

    function updateIsExternalRewardEnabled(bool _status)
        external
        onlyGovernance
    {
        isExternalRewardEnabled = _status;
    }

    function updateIncetivizedController(address _incetivizedController)
        external
        onlyGovernance
    {
        incentivesController = IAaveIncentivesController(
            _incetivizedController
        );
    }

    function updateRewardToken(address _token) external onlyGovernance {
        REWARD_TOKEN = _token;
    }

    function updateAaveAddresses(
        address _lendingPool,
        address _protocolDataProvider
    ) external onlyGovernance {
        require(
            _lendingPool != address(0),
            "AaveYield: lendingPool:: zero address"
        );
        require(
            _protocolDataProvider != address(0),
            "AaveYield: protocolDataProvider:: zero address"
        );

        lendingPool = _lendingPool;
        protocolDataProvider = _protocolDataProvider;
    }

    /**
     * @notice For executing any transaction from the contract
     */
    function executeTransaction(
        address target,
        uint256 value,
        string memory signature,
        bytes memory data
    ) external payable onlyGovernance returns (bytes memory) {
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
            "AaveYield::executeTransaction: Transaction execution reverted."
        );

        return returnData;
    }

    // ************************** //
    // *** INTERNAL FUNCTIONS *** //
    // ************************** //

    function _depositERC20(address _asset, uint256 _amount) internal {
        IAaveLendingPool(lendingPool).deposit(
            _asset,
            _amount,
            address(this),
            referralCode
        );
    }

    function _withdrawERC20(address _asset, uint256 _amount)
        internal
        returns (uint256 amount)
    {
        amount = IAaveLendingPool(lendingPool).withdraw(
            _asset,
            _amount,
            symphony
        );
    }

    function _getATokenAddress(address _asset)
        internal
        view
        returns (address aToken)
    {
        (aToken, , ) = IAavePoolCore(protocolDataProvider)
            .getReserveTokensAddresses(_asset);
    }

    function _calculateAndStoreReward(
        address _asset,
        uint256 _shares,
        uint256 _totalShares,
        uint256 _rewardDebt,
        address _recipient
    ) internal returns (uint256 reward) {
        uint256 totalRewardBalance = getRewardBalance(_asset);
        uint256 accRewardPerShare = getAccumulatedRewardPerShare(
            _asset,
            _totalShares,
            totalRewardBalance
        );

        // reward_amount = shares x (ARPS) - (reward_debt)
        reward = _shares.mul(accRewardPerShare).div(10**18).sub(_rewardDebt);

        pendingRewards[_asset] = totalRewardBalance;
        previousAccRewardPerShare[_asset] = accRewardPerShare;
        userReward[_recipient] = userReward[_recipient].add(reward);
    }

    function _updatePendingReward(address asset, uint256 amount) internal {
        uint256 currentPendingReward = pendingRewards[asset];
        if (amount <= currentPendingReward) {
            pendingRewards[asset] = currentPendingReward.sub(amount);
        } else {
            pendingRewards[asset] = 0;
        }
    }

    receive() external payable {}
}
