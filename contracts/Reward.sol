// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;
pragma experimental ABIEncoderV2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

contract Reward is Initializable, OwnableUpgradeable {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

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
            reward[_addresses[i]] = reward[_addresses[i]].add(_rewards[i]);
        }

        RewardDistributed(epoch);
    }

    function claimReward() external {
        uint256 unclaimedReward = reward[msg.sender];

        require(
            unclaimedReward > 0,
            "claimReward: You don't have any unclaimed rewards"
        );
        emit RewardClaimed(msg.sender, unclaimedReward);
        token.safeTransfer(msg.sender, unclaimedReward);
    }

    function getReward(address user) external view returns (uint256) {
        return reward[user];
    }
}
