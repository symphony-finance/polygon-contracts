// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract Reward is Initializable, OwnableUpgradeable {
    using SafeERC20 for IERC20;

    IERC20 token;
    mapping(address => uint256) reward;

    // ************** //
    // *** EVENTS *** //
    // ************** //
    event RewardDistributed(uint256 epoch);
    event RewardClaimed(address user, uint256 amount);

    function initialize(IERC20 _token, address _owner) external initializer {
        token = _token;
        __Ownable_init();
        super.transferOwnership(_owner);
    }

    function distributeReward(
        uint256 epoch,
        address[] memory _addresses,
        uint256[] memory _rewards
    ) external onlyOwner {
        for (uint256 i = 0; i < _addresses.length; i++) {
            reward[_addresses[i]] = reward[_addresses[i]] + _rewards[i];
        }

        emit RewardDistributed(epoch);
    }

    function claimReward() external {
        uint256 unclaimedReward = reward[msg.sender];

        require(
            unclaimedReward > 0,
            "claimReward: you don't have any unclaimed rewards"
        );

        reward[msg.sender] = 0;
        emit RewardClaimed(msg.sender, unclaimedReward);
        token.safeTransfer(msg.sender, unclaimedReward);
    }

    function getReward(address user) external view returns (uint256) {
        return reward[user];
    }
}
