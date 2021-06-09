// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IHandler {
    /// @notice receive ETH
    receive() external payable;

    /**
     * @notice Handle an order execution
     * @param _inputToken - Address of the input token
     * @param _outputToken - Address of the output token
     * @param _inputAmount - uint256 of the input token amount
     * @param _minReturnAmount - uint256 of the min return amount of output token
     * @param _recepient - Address of the order recipient
     * @param _fee - uint256 execution fee
     * @param _executor - Address of the order executor
     * @param _data - Bytes of arbitrary data
     * @return bought - Amount of output token bought
     */
    function handle(
        address _inputToken,
        address _outputToken,
        uint256 _inputAmount,
        uint256 _minReturnAmount,
        address _recepient,
        uint256 _fee,
        address _executor,
        bytes calldata _data
    ) external returns (uint256 bought);

    /**
     * @notice Check whether can handle an order execution
     * @param _inputToken - Address of the input token
     * @param _outputToken - Address of the output token
     * @param _inputAmount - uint256 of the input token amount
     * @param _minReturnAmount - uint256 minimum return output token
     * @param _stoplossAmount - uint256 stoploss amount
     * @param _feePercent - uint256 execution fee percent
     * @param _data - Bytes of arbitrary data
     * @return bool - Whether the execution can be handled or not
     */
    function canHandle(
        address _inputToken,
        address _outputToken,
        uint256 _inputAmount,
        uint256 _minReturnAmount,
        uint256 _stoplossAmount,
        uint256 _feePercent,
        bytes calldata _data
    ) external view returns (bool);

    /**
     * @notice Simulate an order execution
     * @param _inputToken - Address of the input token
     * @param _outputToken - Address of the output token
     * @param _inputAmount - uint256 of the input token amount
     * @param _minReturnAmount - uint256 minimum return output token
     * @param _stoplossAmount - uint256 stoploss amount
     * @param _feePercent - uint256 execution fee percent
     * @param _data - Bytes of arbitrary data
     * @return success - Whether the execution can be handled or not
     * @return bought - Amount of output token bought
     */
    function simulate(
        address _inputToken,
        address _outputToken,
        uint256 _inputAmount,
        uint256 _minReturnAmount,
        uint256 _stoplossAmount,
        uint256 _feePercent,
        bytes calldata _data
    )
        external
        view
        returns (
            bool success,
            uint256 bought
        );
}
