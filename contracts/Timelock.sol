// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.10;

import "@openzeppelin/contracts/governance/TimelockController.sol";

contract Timelock is TimelockController {
    constructor(
        uint256 delayTime,
        address[] memory proposers,
        address[] memory executors
    ) TimelockController(delayTime, proposers, executors) {}
}
