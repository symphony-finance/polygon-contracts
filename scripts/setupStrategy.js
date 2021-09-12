const fs = require("fs");
const path = require("path");
const fileName = "../config/asset.json";
const file = require("../config/asset.json");
const config = require("../config/index.json");
const assetConfig = require("../config/asset.json");
const SymphonyArtifacts = require(
    "../artifacts/contracts/Symphony.sol/Symphony.json"
);
const { deployAaveYield } = require('./deployAaveYield');

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Using account:", deployer.address);

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

    let assetsData = assetConfig.mumbai;
    if (network.name === "matic") {
        assetsData = assetConfig.matic;
    }

    for (let i = 0; i < assetsData.length; i++) {
        let data = assetsData[i];

        if (data.address) {
            console.log("\nSetting up strategy for", data.token);
            const strategyAddr = await deployAaveYield();

            await symphony.updateStrategy(
                data.address,
                strategyAddr,
            );

            await symphony.updateBufferPercentage(
                data.address,
                data.buffer,
            );

            await symphony.addWhitelistAsset(data.address);

            if (network.name === "mumbai") {
                file.mumbai[i].strategy = strategyAddr;
            } else if (network.name === "matic") {
                file.matic[i].strategy = strategyAddr;
            }

            fs.writeFileSync(
                path.join(__dirname, fileName),
                JSON.stringify(file, null, 2),
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