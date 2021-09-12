// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "../libraries/PercentageMath.sol";
import "../interfaces/IERC20WithDecimal.sol";

contract ChainlinkOracle is Ownable {
    using SafeMath for uint256;
    using PercentageMath for uint256;

    uint256 priceSlippage = 50; // 0.5%

    mapping(address => address) public oracleFeed;

    constructor(address _owner) {
        transferOwnership(_owner);
    }

    // Calculates the lastest exchange rate
    // Uses both divide and multiply only for tokens not supported directly by Chainlink, for example MKR/USD
    function get(
        address inputToken,
        address outputToken,
        uint256 inputAmount
    ) public view returns (uint256 amountOut, uint256 amountOutWithSlippage) {
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

        amountOut = price.mul(inputAmount) / uint256(1e36);

        if (outputToken != address(0))
            amountOut = amountOut.mul(
                10**IERC20WithDecimal(outputToken).decimals()
            );
        if (inputToken != address(0))
            amountOut = amountOut.div(
                10**IERC20WithDecimal(inputToken).decimals()
            );

        amountOutWithSlippage = amountOut.percentMul(
            uint256(10000).sub(priceSlippage)
        );
    }

    function updateTokenFeed(address asset, address feed) external onlyOwner {
        oracleFeed[asset] = feed;
    }

    function updatePriceSlippage(uint256 newSlippage) external onlyOwner {
        priceSlippage = newSlippage;
    }
}

// Chainlink Aggregator
interface IAggregator {
    function latestAnswer() external view returns (int256 answer);
}
