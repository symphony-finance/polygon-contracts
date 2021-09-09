// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "../interfaces/IHandler.sol";
import "../interfaces/IUniswapRouter.sol";
import "../libraries/PercentageMath.sol";
import "../libraries/UniswapLibrary.sol";

/// @notice Quickswap Handler used to execute an order
contract QuickswapHandler is IHandler {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using PercentageMath for uint256;

    address public immutable WETH;
    address public immutable WMATIC;
    address public immutable FACTORY;
    bytes32 public immutable FACTORY_CODE_HASH;
    IUniswapRouter internal immutable UniswapRouter;
    address public immutable symphony;

    /**
     * @notice Creates the handler
     * @param _router - Address of the Quickswap router contract
     * @param _weth - Address of WETH contract
     * @param _wmatic - Address of WMATIC contract
     * @param _codeHash - Bytes32 of the Quickswap v2 pair contract unit code hash
     */
    constructor(
        IUniswapRouter _router,
        address _weth,
        address _wmatic,
        bytes32 _codeHash,
        address _symphony
    ) {
        UniswapRouter = _router;
        WETH = _weth;
        WMATIC = _wmatic;
        FACTORY_CODE_HASH = _codeHash;
        FACTORY = _router.factory();
        symphony = _symphony;
    }

    modifier onlySymphony() {
        require(
            msg.sender == symphony,
            "QuickswapHandler: Only symphony contract can invoke this function"
        );
        _;
    }

    /// @notice receive MATIC
    receive() external payable override {}

    /**
     * @notice Handle an order execution
     */
    function handle(
        IOrderStructs.Order memory order,
        uint256 oracleAmount,
        uint256 feePercent,
        uint256 protcolFeePercent,
        address executor,
        address treasury,
        bytes calldata
    ) external override onlySymphony {
        uint256 amountOutMin = oracleAmount <= order.stoplossAmount ||
            oracleAmount > order.minReturnAmount
            ? oracleAmount
            : order.minReturnAmount;

        uint256 actualAmtOut = _swap(order, amountOutMin);

        _transferTokens(
            order.outputToken,
            actualAmtOut,
            order.recipient,
            executor,
            treasury,
            feePercent,
            protcolFeePercent
        );
    }

    /**
     * @notice Simulate an order execution
     */
    function simulate(
        address _inputToken,
        address _outputToken,
        uint256 _inputAmount,
        uint256 _minReturnAmount,
        uint256 _stoplossAmount,
        uint256 _oracleAmount,
        bytes calldata
    ) external view override returns (bool success, uint256 amountOut) {
        (amountOut, ) = _getPathAndAmountOut(
            _inputToken,
            _outputToken,
            _inputAmount
        );

        return (
            ((amountOut >= _minReturnAmount || amountOut <= _stoplossAmount) &&
                amountOut >= _oracleAmount),
            amountOut
        );
    }

    function _swap(IOrderStructs.Order memory order, uint256 amountOutMin)
        internal
        returns (uint256)
    {
        (, address[] memory path) = _getPathAndAmountOut(
            order.inputToken,
            order.outputToken,
            order.inputAmount
        );

        IERC20(order.inputToken).safeApprove(
            address(UniswapRouter),
            order.inputAmount
        );

        // Swap Tokens
        uint256[] memory returnAmount = UniswapRouter.swapExactTokensForTokens(
            order.inputAmount,
            amountOutMin,
            path,
            address(this),
            block.timestamp.add(1800)
        );

        return returnAmount[returnAmount.length - 1];
    }

    function _transferTokens(
        address token,
        uint256 amount,
        address recipient,
        address executor,
        address treasury,
        uint256 feePercent,
        uint256 protcolFeePercent
    ) internal {
        uint256 protocolFee;
        uint256 totalFee = amount.percentMul(feePercent);

        IERC20(token).safeTransfer(recipient, amount.sub(totalFee));

        if (treasury != address(0)) {
            protocolFee = totalFee.percentMul(protcolFeePercent);
            IERC20(token).safeTransfer(treasury, protocolFee);
        }

        IERC20(token).safeTransfer(executor, totalFee.sub(protocolFee));
    }

    function _getPathAndAmountOut(
        address inputToken,
        address outputToken,
        uint256 inputAmount
    ) internal view returns (uint256 amountOut, address[] memory path) {
        path = new address[](2);
        path[0] = inputToken;
        path[1] = outputToken;

        uint256[] memory _amounts = UniswapLibrary.getAmountsOut(
            FACTORY,
            inputAmount,
            path,
            FACTORY_CODE_HASH
        );

        if (_amounts[1] == 0) {
            path = new address[](3);

            path[0] = inputToken;
            path[1] = WETH; // WETH address
            path[2] = outputToken;

            _amounts = UniswapLibrary.getAmountsOut(
                FACTORY,
                inputAmount,
                path,
                FACTORY_CODE_HASH
            );

            if (_amounts[_amounts.length - 1] == 0) {
                path[1] = WMATIC; // WMATIC address

                _amounts = UniswapLibrary.getAmountsOut(
                    FACTORY,
                    inputAmount,
                    path,
                    FACTORY_CODE_HASH
                );
            }
        }

        amountOut = _amounts[_amounts.length - 1];
    }
}
