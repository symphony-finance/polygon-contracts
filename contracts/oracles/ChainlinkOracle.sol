// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;

import "@openzeppelin/contracts/math/SafeMath.sol";

contract ChainlinkOracle {
    using SafeMath for uint256; // Keep everything in uint256

    address owner;
    mapping(address => address) public oracleFeed;

    modifier onlyOwner {
        require(
            msg.sender == owner,
            "ChainlinkOracle: Only owner contract can invoke this function"
        );
        _;
    }

    constructor(address _owner) {
        owner = _owner;
    }

    // Calculates the lastest exchange rate
    // Uses both divide and multiply only for tokens not supported directly by Chainlink, for example MKR/USD
    function get(
        address inputToken,
        address outputToken,
        uint256 inputAmount
    ) public view returns (uint256) {
        uint256 price = uint256(1e36);

        require(
            oracleFeed[inputToken] != address(0) &&
                oracleFeed[outputToken] != address(0),
            "Oracle does not exist for the token"
        );

        if (inputToken != address(0)) {
            address inputFeedAddress = oracleFeed[inputToken];
            price = price.mul(
                uint256(IAggregator(inputFeedAddress).latestAnswer())
            );
        } else {
            price = price.mul(1e18);
        }

        if (outputToken != address(0)) {
            address outputFeedAddress = oracleFeed[outputToken];
            price =
                price /
                uint256(IAggregator(outputFeedAddress).latestAnswer());
        }

        return price.mul(inputAmount) / uint256(1e36);
    }

    function addTokenFeed(address asset, address feed) external onlyOwner {
        oracleFeed[asset] = feed;
    }
}

// Chainlink Aggregator
interface IAggregator {
    function latestAnswer() external view returns (int256 answer);
}
