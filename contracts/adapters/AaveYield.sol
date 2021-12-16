// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/IYieldAdapter.sol";
import "../interfaces/aave/IAaveLendingPool.sol";
import "../interfaces/aave/IAaveIncentivesController.sol";
import "../interfaces/uniswap/IUniswapRouter.sol";

/**
 * @title Aave Yield contract
 * @notice Implements the functions to deposit/withdraw into Aave
 * @author Symphony Finance
 **/
contract AaveYield is IYieldAdapter {
    using SafeERC20 for IERC20;

    address public immutable yolo;
    address public manager;

    // Addresses related to aave
    address internal immutable tokenAddress;
    address internal immutable aTokenAddress;
    IAaveLendingPool public immutable lendingPool;
    IAaveIncentivesController public immutable incentivesController;
    address public immutable rewardToken;  // can only be native token i.e WMATIC
    uint16 internal constant referralCode = 43915;

    // Addresses related to swap
    address[] route;
    IUniswapRouter public router;
    IUniswapRouter public backupRouter;
    uint256 public harvestMaxGas = 1000000; // 1000k wei

    modifier onlyYolo() {
        require(
            msg.sender == yolo,
            "AaveYield: Only yolo contract can invoke this function"
        );
        _;
    }

    modifier onlyManager() {
        require(
            msg.sender == manager,
            "AaveYield: Only manager contract can invoke this function"
        );
        _;
    }

    /**
     * @dev To initialize the contract addresses interacting with this contract
     **/
    constructor(
        address _yolo,
        address _manager,
        address _tokenAddress,
        IAaveLendingPool _lendingPool,
        IAaveIncentivesController _incentivesController
    ) {
        require(_yolo != address(0), "Yolo:: zero address");
        require(_manager != address(0), "Manager:: zero address");
        require(
            address(_lendingPool) != address(0),
            "lendingPool:: zero address"
        );

        yolo = _yolo;
        manager = _manager;
        lendingPool = _lendingPool;
        tokenAddress = _tokenAddress;
        AaveDataTypes.ReserveData memory reserveData = lendingPool
            .getReserveData(_tokenAddress);
        aTokenAddress = reserveData.aTokenAddress;
        incentivesController = _incentivesController;
        rewardToken = _incentivesController.REWARD_TOKEN();
        _maxApprove(_tokenAddress, reserveData.aTokenAddress);
    }

    /**
     * @dev Used to deposit tokens
     **/
    function deposit(address, uint256 amount) external override onlyYolo {
        _depositERC20(amount);
    }

    /**
     * @dev Used to withdraw tokens
     **/
    function withdraw(address, uint256 amount) external override onlyYolo {
        _withdrawERC20(amount);
    }

    /**
     * @dev Withdraw all tokens from the strategy
     **/
    function withdrawAll(address) external override onlyYolo {
        uint256 amount = IERC20(aTokenAddress).balanceOf(address(this));
        _withdrawERC20(amount);
    }

    /**
     * @dev Used to claim reward and do auto compound
     **/
    function harvestReward() external {
        address[] memory assets = new address[](1);
        assets[0] = aTokenAddress;

        incentivesController.claimRewards(
            assets,
            type(uint256).max,
            address(this)
        );

        address _rewardToken = rewardToken;
        address _tokenAddress = tokenAddress;
        uint256 rewardBal = IERC20(_rewardToken).balanceOf(address(this));

        // reimburse function caller
        uint256 reimbursementAmt = harvestMaxGas * tx.gasprice;
        if (rewardBal > reimbursementAmt) {
            rewardBal -= reimbursementAmt;
            IERC20(_tokenAddress).safeTransfer(msg.sender, reimbursementAmt);
        }

        if (_rewardToken != _tokenAddress) {
            _swapRewards(rewardBal);
        }

        uint256 tokenBal = IERC20(_tokenAddress).balanceOf(address(this));
        if (tokenBal > 0) {
            _depositERC20(tokenBal);
        }
    }

    // *************** //
    // *** GETTERS *** //
    // *************** //

    /**
     * @dev Get amount of underlying tokens
     **/
    function getTotalUnderlying(address)
        public
        view
        override
        returns (uint256 amount)
    {
        amount = IERC20(aTokenAddress).balanceOf(address(this));
    }

    /**
     * @dev Get IOU token address
     **/
    function getIouTokenAddress(address)
        external
        view
        returns (address iouToken)
    {
        iouToken = aTokenAddress;
    }

    /**
     * @dev Get available reward balance
     **/
    function getRewardBalance(address[] memory aTokens)
        external
        view
        returns (uint256 amount)
    {
        amount = incentivesController.getRewardsBalance(aTokens, address(this));
    }

    // ************************** //
    // *** MANAGER METHODS *** //
    // ************************** //

    function updateManager(address _manager) external onlyManager {
        require(
            _manager != address(0),
            "AaveYield::updateManagerAddr: zero address"
        );
        manager = _manager;
    }

    function updateRouter(IUniswapRouter _router) external onlyManager {
        require(
            address(_router) != address(0),
            "AaveYield::updateRouter: zero address"
        );
        address previousRouterAddr = address(router);
        if (previousRouterAddr != address(0)) {
            IERC20(rewardToken).approve(previousRouterAddr, 0);
        }
        router = _router;
        if (address(_router) != address(0)) {
            IERC20(rewardToken).approve(address(_router), type(uint256).max);
        }
    }

    function updateBackupRouter(IUniswapRouter _router) external onlyManager {
        require(
            address(_router) != address(0),
            "AaveYield::updateBackupRouter: zero address"
        );
        address previousRouterAddr = address(backupRouter);
        if (previousRouterAddr != address(0)) {
            IERC20(rewardToken).approve(previousRouterAddr, 0);
        }
        backupRouter = _router;
        if (address(_router) != address(0)) {
            IERC20(rewardToken).approve(address(_router), type(uint256).max);
        }
    }

    function updateRoute(address[] memory _route) external onlyManager {
        require(
            _route[0] == rewardToken &&
                _route[_route.length - 1] == tokenAddress,
            "AaveYield::updateRoute: Incorrect route"
        );
        route = _route;
    }

    function updateHarvestGas(uint256 _gas) external onlyManager {
        harvestMaxGas = _gas;
    }

    // ************************** //
    // *** INTERNAL FUNCTIONS *** //
    // ************************** //

    function _depositERC20(uint256 _amount) internal {
        lendingPool.deposit(tokenAddress, _amount, address(this), referralCode);
    }

    function _withdrawERC20(uint256 _amount) internal returns (uint256 amount) {
        amount = lendingPool.withdraw(tokenAddress, _amount, yolo);
    }

    function _maxApprove(address _token, address _aToken) internal {
        IERC20(_token).safeApprove(address(lendingPool), type(uint256).max);
        IERC20(_aToken).safeApprove(address(lendingPool), type(uint256).max);
    }

    function _swapRewards(uint256 _amount) internal {
        try
            IUniswapRouter(router).swapExactTokensForTokens(
                _amount,
                0,
                route,
                address(this),
                block.timestamp
            )
        {} catch {
            IUniswapRouter(backupRouter).swapExactTokensForTokens(
                _amount,
                0,
                route,
                address(this),
                block.timestamp
            );
        }
    }
}
