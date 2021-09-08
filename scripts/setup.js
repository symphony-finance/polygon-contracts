const config = require("../config/index.json");
const assetConfig = require("../config/asset.json");
const SymphonyArtifacts = require(
    "../artifacts/contracts/Symphony.sol/Symphony.json"
);
const ChainlinkArtifacts = require(
    "../artifacts/contracts/oracles/ChainlinkOracle.sol/ChainlinkOracle.json"
);
const { deploySymphony } = require('./deploySymphony');
const { deployTreasury } = require('./deployTreasury');
const { deployAaveYield } = require('./deployAaveYield');
const { deployWmaticGateway } = require('./deployWmaticGateway');
const { deployChainlinkOracle } = require('./deployChainlinkOracle');
const { deploySushiswapHandler } = require('./deploySushiswapHandler');
const executionFee = 40 // 0.4%
const protocolFee = 2500 // 0.1% (25% of total fee)

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log(
        "Deploying contracts with the account:",
        deployer.address
    );

    console.log("\nDeploying ChainlinkOracle..");
    await deployChainlinkOracle();

    console.log("\nDeploying Symphony..");
    await deploySymphony(executionFee);

    console.log("\nDeploying WMaticGateway..");
    await deployWmaticGateway();

    console.log("\nDeploying Treasury..");
    await deployTreasury();

    console.log("\nDeploying AaveYield..");
    await deployAaveYield();

    console.log("\nDeploying SushiswapHandler..");
    await deploySushiswapHandler();

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
        console.log("\nsetting feed & startegy for asset ", i + 1);

        if (data.feed) {
            await chainlinkOracle.addTokenFeed(
                data.address ? data.address : data.aaveAddress,
                data.feed,
            );
        }

        if ((data.address || data.aaveAddress) && data.strategy) {
            await symphony.updateStrategy(
                data.address ? data.address : data.aaveAddress,
                // data.strategy, // TODO: Update directly in assets.json
                configParams.aaveYieldAddress,
            );

            await symphony.updateBufferPercentage(
                data.address ? data.address : data.aaveAddress,
                data.buffer,
            );

            await symphony.addWhitelistAsset(
                data.address ? data.address : data.aaveAddress
            );
        }
    }

    console.log("\nupdating treasury address in contract");
    await symphony.updateTreasury(configParams.treasury);

    console.log("\nupdating protocol fee in contract");
    await symphony.updateProtocolFee(protocolFee); // 25% of base fee(0.4%)

    // await symphony.executeTransaction(
    //     configParams.aaveIncentivesController,
    //     0,
    //     'claimRewards(address[],uint256,address)',
    //     encodeParameters(
    //         ['address[]', 'uint256', 'address'],
    //         [
    //             ["0x2271e3fef9e15046d09e1d78a8ff038c691e9cf9"],
    //             1,
    //             deployer.address
    //         ]
    //     ),
    // )
}

function encodeParameters(types, values) {
    const abi = new ethers.utils.AbiCoder();
    return abi.encode(types, values);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
