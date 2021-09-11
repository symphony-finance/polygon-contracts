const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const fileName = "../config/index.json";
const file = require("../config/index.json");
const config = require("../config/index.json");

const main = () => {
    return new Promise(async (resolve) => {
        let configParams = config.development;
        if (network.name === "matic") {
            configParams = config.matic;
        } else if (network.name === "mumbai") {
            configParams = config.mumbai;
        }

        // Deploy AaveYield Contract
        const AaveYield = await hre.ethers.getContractFactory("AaveYield");

        upgrades.deployProxy(
            AaveYield,
            [
                configParams.symphonyAddress,
                configParams.admin,
                configParams.aaveLendingPool,
                configParams.aaveProtocolDataProvider,
                configParams.aaveIncentivesController
            ]
        ).then(async (aaveYield) => {
            await aaveYield.deployed();

            console.log(
                "AaveYield contract deployed to:",
                aaveYield.address, "\n"
            );

            if (network.name === "mumbai") {
                file.mumbai.aaveYieldAddress = aaveYield.address;
            } else if (network.name === "matic") {
                file.matic.aaveYieldAddress = aaveYield.address;
            } else {
                file.development.aaveYieldAddress = aaveYield.address;
            }

            fs.writeFileSync(
                path.join(__dirname, fileName),
                JSON.stringify(file, null, 2),
            );

            resolve(true);
        });
    })
}

module.exports = { deployAaveYield: main }
