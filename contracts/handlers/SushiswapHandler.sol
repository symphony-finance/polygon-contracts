// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/IHandler.sol";
import "../libraries/uniswap/UniswapLibrary.sol";
import {IUniswapRouter as ISushiswapRouter} from "../interfaces/uniswap/IUniswapRouter.sol";

/// @notice Sushiswap Handler used to execute an order
contract SushiswapHandler is IHandler {
    using SafeERC20 for IERC20;

    address public immutable WETH;
    address public immutable WMATIC;
    address public immutable FACTORY;
    bytes32 public immutable FACTORY_CODE_HASH;
    ISushiswapRouter internal immutable sushiswapRouter;
    address public immutable yolo;

    /**
     * @notice Creates the handler
     * @param _router - Address of the Sushiswap router contract
     * @param _wmatic - Address of WMATIC contract
     * @param _codeHash - Bytes32 of the Sushiswap pair contract unit code hash
     * @param _yolo - Address of Yolo Contract
     */
    constructor(
        ISushiswapRouter _router,
        address _weth,
        address _wmatic,
        bytes32 _codeHash,
        address _yolo
    ) {
        sushiswapRouter = _router;
        WETH = _weth;
        WMATIC = _wmatic;
        FACTORY_CODE_HASH = _codeHash;
        FACTORY = _router.factory();
        yolo = _yolo;
    }

    modifier onlyYolo() {
        require(
            msg.sender == yolo,
            "SushiswapHandler: only yolo contract can invoke this function"
        );
        _;
    }

    /**
     * @notice Handle an order execution
     */
    function handle(
        IOrderStructs.Order memory order,
        uint256 oracleAmount,
        bytes calldata
    ) external override onlyYolo returns (uint256 actualAmtOut) {
        uint256 amountOutMin = oracleAmount <= order.stoplossAmount ||
            oracleAmount > order.minReturnAmount
            ? oracleAmount
            : order.minReturnAmount;

        actualAmtOut = _swap(order, amountOutMin);
    }

    function _swap(IOrderStructs.Order memory order, uint256 amountOutMin)
        internal
        returns (uint256)
    {
        (, address[] memory path) = _getPathAndAmountOut(
            order.inputToken,
            order.outputToken,
            order.inputAmount,
            amountOutMin
        );

        IERC20(order.inputToken).safeIncreaseAllowance(
            address(sushiswapRouter),
            order.inputAmount
        );

        uint256[] memory returnAmount;
        if (order.outputToken == WMATIC) {
            returnAmount = sushiswapRouter.swapExactTokensForETH(
                order.inputAmount,
                amountOutMin,
                path,
                order.recipient,
                block.timestamp
            );
        } else {
            returnAmount = sushiswapRouter.swapExactTokensForTokens(
                order.inputAmount,
                amountOutMin,
                path,
                order.recipient,
                block.timestamp
            );
        }

        return returnAmount[returnAmount.length - 1];
    }

    function _getPathAndAmountOut(
        address inputToken,
        address outputToken,
        uint256 inputAmount,
        uint256 amountOutMin
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

        if (_amounts[1] < amountOutMin) {
            path = new address[](3);

            path[0] = inputToken;
            path[1] = WETH;
            path[2] = outputToken;

            _amounts = UniswapLibrary.getAmountsOut(
                FACTORY,
                inputAmount,
                path,
                FACTORY_CODE_HASH
            );

            if (_amounts[_amounts.length - 1] < amountOutMin) {
                path[1] = WMATIC;

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
