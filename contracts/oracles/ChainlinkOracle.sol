// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.10;

import "@openzeppelin/contracts/access/Ownable.sol";

import "../interfaces/IOracle.sol";
import "../interfaces/IDetailedERC20.sol";
import "../libraries/PercentageMath.sol";

contract ChainlinkOracle is IOracle, Ownable {
    using PercentageMath for uint256;

    uint256 public priceSlippage = 70; // 0.7%

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

        require(inputToken != outputToken, "same input and output token");
        require(
            oracleFeed[inputToken] != address(0),
            "oracle feed doesn't exist for the input token"
        );

        require(
            oracleFeed[outputToken] != address(0),
            "oracle feed doesn't exist for the output token"
        );

        if (inputToken != address(0)) {
            address inputFeedAddress = oracleFeed[inputToken];
            (, int256 inputAnswer, , , ) = IAggregator(inputFeedAddress)
                .latestRoundData();
            price =
                price *
                (inputAnswer > int256(0) ? uint256(inputAnswer) : 0);
        }

        if (outputToken != address(0)) {
            address outputFeedAddress = oracleFeed[outputToken];
            (, int256 outputAnswer, , , ) = IAggregator(outputFeedAddress)
                .latestRoundData();
            price =
                price /
                (outputAnswer > int256(0) ? uint256(outputAnswer) : 0);
        }

        amountOut = (price * inputAmount) / uint256(1e36);

        if (outputToken != address(0))
            amountOut =
                amountOut *
                (10**IDetailedERC20(outputToken).decimals());
        if (inputToken != address(0))
            amountOut = amountOut / (10**IDetailedERC20(inputToken).decimals());

        amountOutWithSlippage = amountOut.percentMul(
            uint256(10000) - priceSlippage
        );
    }

    function updateTokenFeeds(address[] memory tokens, address[] memory feeds)
        external
        onlyOwner
    {
        for (uint256 i = 0; i < tokens.length; i++) {
            oracleFeed[tokens[i]] = feeds[i];
        }
    }

    function updatePriceSlippage(uint256 newSlippage) external onlyOwner {
        require(
            newSlippage <= 10000,
            "new slippage exceeds max slippage threshold"
        );
        priceSlippage = newSlippage;
    }

    function isOracle() external view returns (bool) {
        return true;
    }
}

// Chainlink Aggregator
interface IAggregator {
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}
