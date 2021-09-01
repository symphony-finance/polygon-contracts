// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";

import "../interfaces/ISymphony.sol";
import "../interfaces/IAaveToken.sol";
import "../interfaces/IAavePoolCore.sol";
import "../interfaces/IYieldAdapter.sol";
import "../interfaces/IAaveLendingPool.sol";
import "../interfaces/IAaveIncentivesController.sol";

/**
 * @title Aave Yield contract
 * @notice Implements the functions to deposit/withdraw into Aave
 * @author Symphony Finance
 **/
contract MockAaveYield is Initializable {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    // Addresses related to aave
    address public aAsset;
    address public lendingPool;
    address public protocolDataProvider;
    IAaveIncentivesController public incentivesController;

    address public symphony;
    address public governance;
    address public REWARD_TOKEN;
    uint16 public referralCode;
    bool public isExternalRewardEnabled;
    uint256 public pendingRewards;
    uint256 public previousAccRewardPerShare;

    mapping(bytes32 => uint256) public orderRewardDebt;

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
    function deposit(address asset, uint256 amount) external {
        require(amount != 0, "AaveYield::deposit: zero amount");

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
            IERC20(aAsset).safeTransferFrom(msg.sender, address(this), amount);

            uint256 underlyingAssetAmt = _withdrawERC20(
                asset,
                amount,
                recipient
            );

            require(
                underlyingAssetAmt > 0,
                "AaveYield::withdraw: incorrect amount withdrawn"
            );
        }

        if (isExternalRewardEnabled && shares > 0 && recipient != address(0)) {
            _calculateAndTransferReward(
                shares,
                totalShares,
                orderRewardDebt[orderId],
                recipient,
                totalRewardBalance
            );
        }
    }

    /**
     * @dev Withdraw all tokens from the strategy
     * @param asset the address of token
     **/
    function withdrawAll(address asset) external {
        uint256 amount = IERC20(aAsset).balanceOf(address(this));

        if (amount > 0) {
            _withdrawERC20(asset, amount, msg.sender);
        }
    }

    /**
     * @dev Used to set external reward debt at the time of order creation
     * @param orderId the id of the order
     **/
    function setOrderRewardDebt(
        bytes32 orderId,
        address,
        uint256 shares,
        uint256 totalShares,
        uint256 totalRewardBalance
    ) external {
        // uint256 totalRewardBalance = getRewardBalance();
        uint256 accRewardPerShare = getAccumulatedRewardPerShare(
            totalShares,
            totalRewardBalance
        );

        pendingRewards = totalRewardBalance;
        previousAccRewardPerShare = accRewardPerShare;
        orderRewardDebt[orderId] = shares.mul(accRewardPerShare).div(10**18);
    }

    /**
     * @dev Used to approve max token and add token for reward
     * @param asset the address of token
     **/
    function maxApprove(address asset) external {
        address aToken = getYieldTokenAddress(asset);
        aAsset = aToken;

        IERC20(asset).safeApprove(lendingPool, uint256(-1));
        IERC20(aToken).safeApprove(lendingPool, uint256(-1));
    }

    // *************** //
    // *** GETTERS *** //
    // *************** //

    /**
     * @dev Used to get amount of underlying tokens
     * @return amount amount of underlying tokens
     **/
    function getTotalUnderlying(address) public view returns (uint256 amount) {
        amount = IERC20(aAsset).balanceOf(address(this));
    }

    /**
     * @dev Used to get IOU token address
     * @param asset the address of token
     * @return iouToken address of IOU token
     **/
    function getYieldTokenAddress(address asset)
        public
        view
        returns (address iouToken)
    {
        (iouToken, , ) = IAavePoolCore(protocolDataProvider)
            .getReserveTokensAddresses(asset);
    }

    /**
     * @dev Used to get external reward balance
     **/
    function getRewardBalance() public view returns (uint256 amount) {
        if (isExternalRewardEnabled) {
            address[] memory assets = new address[](1);
            assets[0] = aAsset;

            amount = incentivesController.getRewardsBalance(
                assets,
                address(this)
            );
        }
    }

    function getAccumulatedRewardPerShare(
        uint256 totalShares,
        uint256 rewardBalance
    ) public view returns (uint256 result) {
        // ARPS = previous_APRS + (new_reward / total_shares)
        uint256 newReward = rewardBalance.sub(pendingRewards);

        // ARPS stored in 10^18 denomination.
        uint256 newRewardPerShare;
        if (totalShares > 0) {
            newRewardPerShare = newReward.mul(10**18).div(totalShares);
        }

        result = previousAccRewardPerShare.add(newRewardPerShare);
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

    function updateIncentivesController(address _incetivesController)
        external
        onlyGovernance
    {
        incentivesController = IAaveIncentivesController(_incetivesController);
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

    function _withdrawERC20(
        address _asset,
        uint256 _amount,
        address _recipient
    ) internal returns (uint256 amount) {
        amount = IAaveLendingPool(lendingPool).withdraw(
            _asset,
            _amount,
            _recipient
        );
    }

    function _calculateAndTransferReward(
        uint256 _shares,
        uint256 _totalShares,
        uint256 _rewardDebt,
        address _recipient,
        uint256 totalRewardBalance
    ) internal returns (uint256 reward) {
        // uint256 totalRewardBalance = getRewardBalance();
        uint256 accRewardPerShare = getAccumulatedRewardPerShare(
            _totalShares,
            totalRewardBalance
        );

        // reward_amount = shares x (ARPS) - (reward_debt)
        reward = _shares.mul(accRewardPerShare).div(10**18).sub(_rewardDebt);

        pendingRewards = totalRewardBalance;
        previousAccRewardPerShare = accRewardPerShare;
        _transferReward(reward, _recipient);
    }

    /**
     * @notice Transfer WMATIC reward to order recipient
     */
    function _transferReward(uint256 _reward, address _recipient) internal {
        if (_reward > 0) {
            address[] memory assets = new address[](1);
            assets[0] = aAsset;

            incentivesController.claimRewards(assets, _reward, _recipient);
        }
    }

    receive() external payable {}
}
