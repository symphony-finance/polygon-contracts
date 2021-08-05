// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "hardhat/console.sol";

import "../interfaces/IYieldAdapter.sol";
import "../interfaces/IAaveToken.sol";
import "../interfaces/IAaveLendingPool.sol";
import "../interfaces/IAavePoolCore.sol";
import "../interfaces/IAaveIncentivesController.sol";
import "../libraries/UniswapLibrary.sol";
import "../interfaces/IUniswapRouter.sol";

/**
 * @title Mock Aave Yield contract
 * @notice Implements the functions to deposit/withdraw into Aave
 * @author Symphony Finance
 **/
contract MockAaveYield is Initializable {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    // Addresses related to aave
    address public lendingPool;
    address public protocolDataProvider;
    IAaveIncentivesController public incentivesController;

    address symphony;
    address governance;
    uint16 public referralCode;
    bool public isExternalRewardEnabled;

    mapping(bytes32 => uint256) public orderRewardDebt;
    mapping(address => uint256) public pendingRewards;
    mapping(address => uint256) public previousAccRewardPerShare;
    mapping(address => uint256) public userReward;
    mapping(address => uint256) public assetTotalAccReward;

    modifier onlySymphony {
        require(
            msg.sender == symphony,
            "AaveYield: Only symphony contract can invoke this function"
        );
        _;
    }

    modifier onlyGovernance {
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

    function updateReferralCode(uint16 _referralCode) external onlyGovernance {
        referralCode = _referralCode;
    }

    function updateIncetivizedController(address _incetivizedController)
        external
        onlyGovernance
    {
        incentivesController = IAaveIncentivesController(
            _incetivizedController
        );
    }

    /**
     * @dev Used to deposit tokens in available protocol
     * @param asset the address of token to invest
     * @param amount the amount of asset
     **/
    function deposit(address asset, uint256 amount) external {
        require(amount != 0, "AaveYield: zero amount");

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
        bytes32 orderId,
        uint256 totalRewardBalance
    ) external {
        if (amount > 0) {
            address aToken = getATokenAddress(asset);

            IERC20(aToken).safeTransferFrom(msg.sender, address(this), amount);

            uint256 underlyingAssetAmt = _withdrawERC20(
                asset,
                amount,
                msg.sender
            );

            require(
                underlyingAssetAmt > 0,
                "AaveYield::withdraw: incorrect amount withdrawn"
            );
        }

        if (isExternalRewardEnabled && shares > 0 && recipient != address(0)) {
            calculateAndStoreReward(
                asset,
                shares,
                totalShares,
                orderRewardDebt[orderId],
                recipient,
                totalRewardBalance
            );
        }
    }

    /**
     * @dev Used to approve max token from yield provider contract
     * @param _asset the address of token
     **/
    function maxApprove(address _asset) external {
        address aToken = getATokenAddress(_asset);
        IERC20(_asset).safeApprove(lendingPool, uint256(-1));
        IERC20(aToken).safeApprove(lendingPool, uint256(-1));
    }

    /**
     * @dev Used to get amount of underlying tokens
     * @param asset the address of asset
     * @return amount amount of underlying tokens
     **/
    function getTokensForShares(address asset)
        external
        view
        returns (uint256 amount)
    {
        address aToken = getATokenAddress(asset);

        amount = IERC20(aToken).balanceOf(symphony);
    }

    /**
     * @dev Used to get IOU token address
     * @param _asset the address of token
     * @return iouToken address of IOU token
     **/
    function getYieldTokenAddress(address _asset)
        external
        view
        returns (address iouToken)
    {
        (iouToken, , ) = IAavePoolCore(protocolDataProvider)
        .getReserveTokensAddresses(_asset);
    }

    function getRewardBalance(address _asset)
        public
        view
        returns (uint256 amount)
    {
        if (isExternalRewardEnabled) {
            address aToken = getATokenAddress(_asset);
            address[] memory assets = new address[](1);
            assets[0] = aToken;

            amount = incentivesController.getRewardsBalance(assets, symphony);
        }
    }

    function getAccumulatedRewardPerShare(
        address asset,
        uint256 totalShares,
        uint256 rewardBalance
    ) public view returns (uint256 result) {
        // ARPC = previous_APRC + (new_reward / total_shares)
        uint256 newReward = rewardBalance.sub(pendingRewards[asset]);
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

    function setOrderRewardDebt(
        bytes32 _orderId,
        address _asset,
        uint256 _shares,
        uint256 _totalShares,
        uint256 totalRewardBalance
    ) external {
        if (totalRewardBalance > 0) {
            uint256 accRewardPerShare = getAccumulatedRewardPerShare(
                _asset,
                _totalShares,
                totalRewardBalance
            );
            uint256 orderDebt = calculateOrderDebt(_shares, accRewardPerShare);

            pendingRewards[_asset] = totalRewardBalance;
            previousAccRewardPerShare[_asset] = accRewardPerShare;
            orderRewardDebt[_orderId] = orderDebt;
        }
    }

    function _depositERC20(address asset, uint256 amount) internal {
        IAaveLendingPool(lendingPool).deposit(
            asset,
            amount,
            address(this),
            referralCode
        );
    }

    function _withdrawERC20(
        address asset,
        uint256 amount,
        address recipient
    ) internal returns (uint256) {
        uint256 underlyingAsssetAmt = IAaveLendingPool(lendingPool).withdraw(
            asset,
            amount,
            recipient
        );
        return underlyingAsssetAmt;
    }

    function getATokenAddress(address asset)
        internal
        view
        returns (address aToken)
    {
        (aToken, , ) = IAavePoolCore(protocolDataProvider)
        .getReserveTokensAddresses(asset);
    }

    function calculateAndStoreReward(
        address _asset,
        uint256 _shares,
        uint256 _totalShares,
        uint256 _rewardDebt,
        address _recipient,
        uint256 totalRewardBalance
    ) public returns (uint256 reward) {
        // uint256 totalRewardBalance = getRewardBalance(_asset);
        uint256 accRewardPerShare = getAccumulatedRewardPerShare(
            _asset,
            _totalShares,
            totalRewardBalance
        );

        // reward_amount = shares x (ARCP) - (reward_debt)
        reward = _shares.mul(accRewardPerShare).div(10**18).sub(_rewardDebt);
        console.log("reward balance is %s tokens", reward);

        pendingRewards[_asset] = totalRewardBalance;
        previousAccRewardPerShare[_asset] = accRewardPerShare;
        userReward[_recipient] = userReward[_recipient].add(reward);
    }

    function withdrawReward(
        address _asset,
        uint256 _amount,
        address _recipient
    ) public {
        address[] memory assets = new address[](1);
        assets[0] = _asset;

        incentivesController.claimRewards(assets, _amount, _recipient);
    }

    function withdrawToken(address _asset, uint256 _amount) public {
        IERC20(_asset).safeTransfer(msg.sender, _amount);
    }

    function getWmaticRewardBalance(address _asset)
        public
        view
        returns (uint256 amount)
    {
        address[] memory assets = new address[](1);
        assets[0] = _asset;

        amount = incentivesController.getRewardsBalance(assets, address(this));
    }

    function getUnclaimedRewards() public view returns (uint256 amount) {
        amount = incentivesController.getUserUnclaimedRewards(address(this));
    }

    /**
     * @dev Withdraw all tokens from the strategy
     * @param asset the address of token
     **/
    function withdrawAll(address asset) external {
        address aToken = getATokenAddress(asset);

        address[] memory assets = new address[](1);
        assets[0] = aToken;

        uint256 amount = IERC20(aToken).balanceOf(symphony);
        _withdrawERC20(asset, amount, msg.sender);
    }

    function updatePendingReward(address asset, uint256 amount) external {
        uint256 currentPendingReward = pendingRewards[asset];

        if (amount <= currentPendingReward) {
            pendingRewards[asset] = currentPendingReward.sub(amount);
        } else {
            pendingRewards[asset] = 0;
        }
    }

    receive() external payable {}
}
