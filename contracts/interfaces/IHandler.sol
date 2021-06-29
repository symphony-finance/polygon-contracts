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
     * @param _feePercent - uint256 total execution fee percent
     * @param _protocolFeePercent - uint256 protocol fee percent
     * @param _executor - Address of the order executor
     * @param _treasury - Address of the protocol treasury
     * @param _data - Bytes of arbitrary data
     */
    function handle(
        address _inputToken,
        address _outputToken,
        uint256 _inputAmount,
        uint256 _minReturnAmount,
        address _recepient,
        uint256 _feePercent,
        uint256 _protocolFeePercent,
        address _executor,
        address _treasury,
        bytes calldata _data
    ) external;

    /**
     * @notice Check whether can handle an order execution
     * @param _inputToken - Address of the input token
     * @param _outputToken - Address of the output token
     * @param _inputAmount - uint256 of the input token amount
     * @param _minReturnAmount - uint256 minimum return output token
     * @param _stoplossAmount - uint256 stoploss amount
     * @param _feePercent - uint256 total execution fee percent
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
    ) external view returns (bool success, uint256 bought);
}
