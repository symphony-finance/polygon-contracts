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
import "../libraries/UniswapLibrary.sol";
import "../interfaces/IUniswapRouter.sol";

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

    address symphony;
    address governance;
    uint16 public referralCode;
    bool public isExternalRewardEnabled;

    mapping(bytes32 => uint256) orderRewardDebt;

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
        address aToken = getATokenAddress(asset);

        if (amount > 0) {
            emit Withdraw(asset, amount);

            IERC20(aToken).safeTransferFrom(msg.sender, address(this), amount);

            uint256 underlyingAssetAmt = _withdrawERC20(asset, amount);

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
                aToken,
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
     * @param router address of the dex router
     * @param slippage max slippage in case of swap
     * @param codeHash DEX router code hash
     * @param path desired path(only in case of swap)
     **/
    function withdrawAll(
        address asset,
        address router,
        uint256 slippage,
        bytes32 codeHash,
        address[] calldata path
    ) external override onlySymphony {
        address aToken = getATokenAddress(asset);

        address[] memory assets = new address[](1);
        assets[0] = aToken;

        uint256 amount = IERC20(aToken).balanceOf(symphony);
        if (amount > 0) {
            _withdrawERC20(asset, amount);
        }

        if (router != address(0) && codeHash != bytes32(0)) {
            uint256 rewardAmount = calculateAndTransferWmaticReward(
                aToken,
                100,
                100,
                0,
                address(this)
            );

            swap(
                incentivesController.REWARD_TOKEN(),
                rewardAmount,
                router,
                slippage,
                codeHash,
                path
            );
        }
    }

    /**
     * @dev Used to approve max token from yield provider contract
     * @param asset the address of token
     **/
    function maxApprove(address asset) external override {
        address aToken = getATokenAddress(asset);
        IERC20(asset).safeApprove(lendingPool, uint256(-1));
        IERC20(aToken).safeApprove(lendingPool, uint256(-1));
    }

    /**
     * @dev Used to set external reward debt at the time of order creation
     * @param orderId the id of the order
     * @param asset the address of token
     **/
    function setOrderRewardDebt(bytes32 orderId, address asset)
        external
        override
    {
        uint256 currentRewardBalance = getRewardBalance(asset);
        if (currentRewardBalance > 0) {
            orderRewardDebt[orderId] = currentRewardBalance;
        }
    }

    // *************** //
    // *** GETTERS *** //
    // *************** //

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
            address aToken = getATokenAddress(asset);
            address[] memory assets = new address[](1);
            assets[0] = aToken;

            amount = incentivesController.getRewardsBalance(assets, symphony);
        }
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

    // ************************** //
    // *** INTERNAL FUNCTIONS *** //
    // ************************** //

    function _depositERC20(address _asset, uint256 _amount) internal {
        IAaveLendingPool(lendingPool).deposit(
            _asset,
            _amount,
            symphony,
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

    function getATokenAddress(address _asset)
        internal
        view
        returns (address aToken)
    {
        (aToken, , ) = IAavePoolCore(protocolDataProvider)
        .getReserveTokensAddresses(_asset);
    }

    function calculateAndTransferWmaticReward(
        address _asset,
        uint256 _shares,
        uint256 _totalShares,
        uint256 _rewardDebt,
        address _recipient
    ) internal returns (uint256 reward) {
        address[] memory assets = new address[](1);
        assets[0] = _asset;

        uint256 totalTokens = incentivesController.getRewardsBalance(
            assets,
            symphony
        );

        if (totalTokens > 0) {
            uint256 rewardBalance = totalTokens.sub(_rewardDebt);
            uint256 amount = _shares.mul(rewardBalance).div(_totalShares);

            reward = incentivesController.claimRewards(
                assets,
                amount,
                _recipient
            );
        }
    }

    function swap(
        address _inputToken,
        uint256 _inputAmount,
        address _router,
        uint256 _slippage,
        bytes32 _codeHash,
        address[] calldata _path
    ) internal {
        IERC20(_inputToken).safeApprove(_router, _inputAmount);

        uint256 amountOut = getAmountOut(
            _inputAmount,
            _router,
            _codeHash,
            _path
        );

        // Swap Tokens
        IUniswapRouter(_router).swapExactTokensForTokens(
            _inputAmount,
            amountOut.mul(uint256(100).sub(_slippage)).div(100), // Slipage: 2 for 2%
            _path,
            symphony,
            block.timestamp.add(1800)
        );
    }

    function getAmountOut(
        uint256 _inputAmount,
        address _router,
        bytes32 _codeHash,
        address[] calldata path
    ) internal view returns (uint256 amountOut) {
        address factory = IUniswapRouter(_router).factory();

        uint256[] memory _amounts = UniswapLibrary.getAmountsOut(
            factory,
            _inputAmount,
            path,
            _codeHash
        );

        amountOut = _amounts[_amounts.length - 1];
    }

    receive() external payable {}
}
