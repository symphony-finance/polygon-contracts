// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.10;

interface IYieldAdapter {
    /**
     * @dev Used to deposit token
     * @param token the address of token to invest
     * @param amount the amount of token
     **/
    function deposit(address token, uint256 amount) external;

    /**
     * @dev Used to withdraw from available protocol
     * @param token the address of underlying token
     * @param amount the amount of liquidity shares to unlock
     **/
    function withdraw(address token, uint256 amount) external;

    /**
     * @dev Withdraw all tokens from the strategy
     * @param token the address of token
     **/
    function withdrawAll(address token) external;

    /**
     * @dev Used to get amount of underlying tokens
     * @param token the address of token
     * @return tokensAmount amount of underlying tokens
     **/
    function getTotalUnderlying(address token)
        external
        returns (uint256 tokensAmount);
}
