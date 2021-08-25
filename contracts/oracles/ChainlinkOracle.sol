// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;

import "../interfaces/IERC20WithDecimal.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

contract ChainlinkOracle {
    using SafeMath for uint256;

    address owner;
    mapping(address => address) public oracleFeed;

    modifier onlyOwner() {
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
    ) public view returns (uint256 oracleAmount) {
        uint256 price = uint256(1e36);

        require(
            oracleFeed[inputToken] != address(0),
            "Oracle feed doesn't exist for the input asset."
        );

        require(
            oracleFeed[outputToken] != address(0),
            "Oracle feed doesn't exist for the output asset."
        );

        if (inputToken != address(0)) {
            address inputFeedAddress = oracleFeed[inputToken];
            price = price.mul(
                uint256(IAggregator(inputFeedAddress).latestAnswer())
            );
        }

        if (outputToken != address(0)) {
            address outputFeedAddress = oracleFeed[outputToken];
            price =
                price /
                uint256(IAggregator(outputFeedAddress).latestAnswer());
        }

        oracleAmount = price.mul(inputAmount) / uint256(1e36);

        if (outputToken != address(0)) {
            uint8 inputDecimal = IERC20WithDecimal(inputToken).decimals();
            uint8 outputDecimal = IERC20WithDecimal(outputToken).decimals();

            if (inputDecimal != outputDecimal) {
                oracleAmount = oracleAmount.mul(10**outputDecimal).div(
                    10**inputDecimal
                );
            }
        }
    }

    function addTokenFeed(address asset, address feed) external onlyOwner {
        oracleFeed[asset] = feed;
    }
}

// Chainlink Aggregator
interface IAggregator {
    function latestAnswer() external view returns (int256 answer);
}
