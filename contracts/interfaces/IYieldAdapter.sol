// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.10;

interface IYieldAdapter {
    /**
     * @dev Used to deposit token
     * @param asset the address of token to invest
     * @param amount the amount of asset
     **/
    function deposit(address asset, uint256 amount) external;

    /**
     * @dev Used to withdraw from available protocol
     * @param asset the address of underlying token
     * @param amount the amount of liquidity shares to unlock
     **/
    function withdraw(address asset, uint256 amount) external;

    /**
     * @dev Withdraw all tokens from the strategy
     * @param asset the address of token
     **/
    function withdrawAll(address asset) external;

    /**
     * @dev Used to get amount of underlying tokens
     * @param asset the address of token
     * @return tokensAmount amount of underlying tokens
     **/
    function getTotalUnderlying(address asset)
        external
        returns (uint256 tokensAmount);

    /**
     * @dev Used to get IOU token address
     * @param asset the address of token
     * @return iouToken address of IOU token
     **/
    function getYieldTokenAddress(address asset)
        external
        view
        returns (address iouToken);
}
