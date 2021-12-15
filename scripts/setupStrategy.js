const fs = require("fs");
const path = require("path");
const fileName = "../config/asset.json";
const file = require("../config/asset.json");
const config = require("../config/index.json");
const assetConfig = require("../config/asset.json");
const { deployAaveYield } = require('./adapters/deployAaveYield');
const YoloArtifacts = require( "../artifacts/contracts/Yolo.sol/Yolo.json");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Using account:", deployer.address);

    let configParams = config.development;
    if (network.name === "matic") {
        configParams = config.matic;
    } else if (network.name === "mumbai") {
        configParams = config.mumbai;
    }

    const yolo = new ethers.Contract(
        configParams.yoloAddress,
        YoloArtifacts.abi,
        deployer
    );

    let assetsData = assetConfig.mumbai;
    if (network.name === "matic") {
        assetsData = assetConfig.matic;
    }

    for (let i = 0; i < assetsData.length; i++) {
        let data = assetsData[i];

        if (data.address && !data.strategy) {
            console.log("\nSetting up strategy for", data.token);
            const strategyAddr = await deployAaveYield(data.token);

            const tx1 = await yolo.setStrategy(
                data.address,
                strategyAddr,
            );
            await tx1.wait();

            if (data.buffer > 0) {
                const tx2 = await yolo.updateTokenBuffer(
                    data.address,
                    data.buffer,
                );
                await tx2.wait();
            }

            const tx3 = await yolo.addWhitelistToken(data.address);
            await tx3.wait();

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
