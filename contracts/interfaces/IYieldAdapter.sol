// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;

interface IYieldAdapter {
    /**
     * @dev emitted when tokens are deposited
     * @param investedTo the address of contract to invest in
     * @param sharesReceived the amount of shares received
     **/
    event Deposit(address investedTo, uint256 sharesReceived);

    /**
     * @dev emitted when tokens are withdrawn
     * @param investedTo the address of contract invested in
     * @param tokensReceived the amount of underlying asset received
     **/
    event Withdraw(address investedTo, uint256 tokensReceived);

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
    function withdraw(address asset, uint256 amount)
        external;

    /**
     * @dev Used to approve max token from yield provider contract
     * @param asset the address of token
     **/
    function maxApprove(address asset) external;

    /**
     * @dev Used to get amount of underlying tokens
     * @param asset the address of token
     * @return tokensAmount amount of underlying tokens
     **/
    function getTokensForShares(address asset)
        external
        view
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
