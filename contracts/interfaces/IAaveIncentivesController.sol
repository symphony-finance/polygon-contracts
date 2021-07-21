// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;

interface IAaveIncentivesController {
    function claimRewards(
        address[] calldata,
        uint256 amount,
        address to
    ) external returns (uint256);

    function getRewardsBalance(address[] calldata assets, address user)
        external
        view
        returns (uint256);

    function getUserUnclaimedRewards(address user)
        external
        view
        returns (uint256);
}
