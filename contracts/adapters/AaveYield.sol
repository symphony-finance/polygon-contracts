// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

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
contract AaveYield is IYieldAdapter {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    // Addresses related to aave
    address public lendingPool;
    address public protocolDataProvider;
    IAaveIncentivesController public incentivesController;

    address symphony;
    address governance;
    uint16 public referralCode;

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
    constructor(
        address _symphony,
        address _governance,
        address _lendingPool,
        address _protocolDataProvider,
        address _incentivesController
    ) {
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
    function deposit(address asset, uint256 amount)
        external
        override
        onlySymphony
    {
        require(amount != 0, "AaveYield: zero amount");

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
        address recipient
    ) external override onlySymphony {
        require(amount != 0, "AaveYield: withdraw:: amount can't be zero");

        address aToken = getATokenAddress(asset);

        emit Withdraw(asset, amount);

        IERC20(aToken).safeTransferFrom(msg.sender, address(this), amount);

        uint256 underlyingAssetAmt = _withdrawERC20(asset, amount);

        // todo: add/change validation?
        if (amount > 0) {
            require(
                underlyingAssetAmt > 0,
                "AaveYield::withdraw: incorrect amount withdrawn"
            );
        }

        if (
            shares > 0 &&
            recipient != address(0) &&
            address(incentivesController) != address(0)
        ) {
            calculateAndTransferWmaticReward(
                asset,
                shares,
                totalShares,
                recipient
            );
        }
    }

    /**
     * @dev Used to approve max token from yield provider contract
     * @param _asset the address of token
     **/
    function maxApprove(address _asset) external override {
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
        override
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
        override
        returns (address iouToken)
    {
        (iouToken, , ) = IAavePoolCore(protocolDataProvider)
        .getReserveTokensAddresses(_asset);
    }

    function _depositERC20(address asset, uint256 amount) internal {
        IAaveLendingPool(lendingPool).deposit(
            asset,
            amount,
            symphony,
            referralCode
        );
    }

    function _withdrawERC20(address asset, uint256 amount)
        internal
        returns (uint256)
    {
        uint256 underlyingAsssetAmt = IAaveLendingPool(lendingPool).withdraw(
            asset,
            amount,
            symphony
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

    function calculateAndTransferWmaticReward(
        address _asset,
        uint256 _shares,
        uint256 _totalShares,
        address _recipient
    ) internal {
        address[] memory assets = new address[](1);
        assets[0] = _asset;

        uint256 totalTokens = incentivesController.getRewardsBalance(
            assets,
            symphony
        );

        uint256 amount = _shares.mul(totalTokens).div(_totalShares);

        incentivesController.claimRewards(assets, amount, _recipient);
    }

    function getWmaticRewardBalance(address _asset)
        public
        view
        returns (uint256 amount)
    {
        address[] memory assets = new address[](1);
        assets[0] = _asset;

        amount = incentivesController.getRewardsBalance(assets, symphony);
    }

    receive() external payable {}
}
