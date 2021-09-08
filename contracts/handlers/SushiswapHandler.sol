// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

import "../interfaces/IOracle.sol";
import "../interfaces/IHandler.sol";
import "../libraries/PercentageMath.sol";
import "../libraries/UniswapLibrary.sol";
import "../interfaces/IUniswapRouter.sol";

/// @notice Sushiswap Handler used to execute an order
contract SushiswapHandler is IHandler {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using PercentageMath for uint256;

    address public immutable FACTORY;
    bytes32 public immutable FACTORY_CODE_HASH;
    IUniswapRouter internal immutable UniswapRouter;
    IOracle public immutable oracle;
    address public immutable symphony;

    /**
     * @notice Creates the handler
     * @param _router - Address of the Sushiswap router contract
     * @param _codeHash - Bytes32 of the Sushiswap v2 pair contract unit code hash
     */
    constructor(
        IUniswapRouter _router,
        bytes32 _codeHash,
        IOracle _oracle,
        address _symphony
    ) {
        UniswapRouter = _router;
        FACTORY_CODE_HASH = _codeHash;
        oracle = _oracle;
        FACTORY = _router.factory();
        symphony = _symphony;
    }

    modifier onlySymphony() {
        require(
            msg.sender == symphony,
            "SushiswapHandler: Only symphony contract can invoke this function"
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
        uint256 feePercent,
        uint256 protcolFeePercent,
        address executor,
        address treasury,
        bytes calldata handlerData
    ) external override onlySymphony {
        uint256 oracleAmount = oracle.get(
            order.inputToken,
            order.outputToken,
            order.inputAmount
        );

        uint256 amountOutMin = oracleAmount <= order.stoplossAmount ||
            oracleAmount > order.minReturnAmount
            ? oracleAmount
            : order.minReturnAmount;

        address[] memory path = _decodeData(handlerData);

        uint256 actualAmtOut = _swap(order, path, amountOutMin);

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

    function _swap(
        IOrderStructs.Order memory order,
        address[] memory path,
        uint256 amountOutMin
    ) internal returns (uint256) {
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

    function _decodeData(bytes memory _data)
        internal
        view
        returns (address[] memory path)
    {
        path = abi.decode(_data, (address[]));
    }
}
