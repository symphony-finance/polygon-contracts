const config = require("../config/index.json");
const assetConfig = require("../config/asset.json");
const SymphonyArtifacts = require(
    "../artifacts/contracts/Symphony.sol/Symphony.json"
);
const ChainlinkArtifacts = require(
    "../artifacts/contracts/oracles/ChainlinkOracle.sol/ChainlinkOracle.json"
);

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log(
        "Deploying contracts with the account:",
        deployer.address
    );

    // Deploy Symphony
    // Deploy Aave yield adapter
    // Deploy Chainlink Oracle
    // Deploy Quickswap Handler
    // Deploy Treasury

    let configParams = config.development;
    if (network.name === "matic") {
        configParams = config.matic;
    } else if (network.name === "mumbai") {
        configParams = config.mumbai;
    }

    const symphony = new ethers.Contract(
        configParams.symphonyAddress,
        SymphonyArtifacts.abi,
        deployer
    );

    const chainlinkOracle = new ethers.Contract(
        configParams.chainlinkOracle,
        ChainlinkArtifacts.abi,
        deployer,
    );

    let assetsData = assetConfig.mumbai;
    if (network.name === "matic") {
        assetsData = assetConfig.matic;
    }


    for (let i = 0; i < assetsData.length; i++) {
        let data = assetsData[i];

        if (data.feed) {
            await chainlinkOracle.addTokenFeed(
                data.address ? data.address : data.chainlinkAddress,
                data.feed,
            );
        }

        if ((data.address || data.aaveAddress) && data.strategy) {
            await symphony.updateTokenStrategyAndBuffer(
                data.address ? data.address : data.aaveAddress,
                data.strategy,
                data.buffer,
            );
        }
    }

    await symphony.updateTreasury(configParams.treasury);
    await symphony.updateProtocolFee(2500); // 25% of base fee(0.4%)
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
