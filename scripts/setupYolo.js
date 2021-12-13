const config = require("../config/index.json");
const assetConfig = require("../config/asset.json");
const globalArgs = require('../config/arguments.json');
const SymphonyArtifacts = require(
    "../artifacts/contracts/Symphony.sol/Symphony.json"
);
const ChainlinkArtifacts = require(
    "../artifacts/contracts/oracles/ChainlinkOracle.sol/ChainlinkOracle.json"
);
const { deployYolo } = require('./deployYolo');
const { deployTreasury } = require('./deployTreasury');
const { deployChainlinkOracle } = require('./deployChainlinkOracle');
const { deploySushiswapHandler } = require('./deploySushiswapHandler');
const { deployQuickswapHandler } = require('./deployQuickswapHandler');
const { deployBalancerHandler } = require('./deployBalancerHandler');

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log(
        "Deploying contracts with the account:",
        deployer.address
    );

    console.log("\nDeploying ChainlinkOracle..");
    await deployChainlinkOracle();

    console.log("\nDeploying Yolo..");
    await deployYolo();

    console.log("\nDeploying Treasury..");
    await deployTreasury();

    console.log("\nDeploying SushiswapHandler..");
    await deploySushiswapHandler();

    // Note: Only deploy on matic mainnet (not on testnet)
    console.log("\nDeploying QuickswapHandler..");
    await deployQuickswapHandler();

    // Note: Only deploy on matic mainnet (not on testnet)
    console.log("\nDeploying BalancerHandler..");
    await deployBalancerHandler();

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

    console.log("\nupdating treasury address in contract");
    const tx1 = await symphony.updateTreasury(configParams.treasury);
    await tx1.wait();

    console.log("\nupdating protocol fee in contract");
    const tx2 = await symphony.updateProtocolFee(
        globalArgs.symphony.protocolFeePercent
    );
    await tx2.wait();

    console.log("\nupdating cancellation fee in contract");
    const tx3 = await symphony.updateCancellationFee(
        globalArgs.symphony.cancellationFeePercent
    );
    await tx3.wait();

    for (let i = 0; i < assetsData.length; i++) {
        let data = assetsData[i];
        console.log("\nsetting feed & startegy for asset ", i + 1);

        if (data.feed) {
            await chainlinkOracle.updateTokenFeed(
                data.address,
                data.feed,
            );
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
