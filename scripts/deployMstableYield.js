const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const config = require("../config/index.json");
const file = require("../config/index.json");
const fileName = "../config/index.json";

const main = () => {
    return new Promise(async (resolve) => {
        const [deployer] = await ethers.getSigners();

        let configParams = config.development;
        if (network.name === "matic") {
            configParams = config.matic;
        } else if (network.name === "mumbai") {
            configParams = config.mumbai;
        }

        // Deploy MstableYield Contract
        const MstableYield = await hre.ethers.getContractFactory("MstableYield");

        upgrades.deployProxy(
            MstableYield,
            [
                configParams.symphonyAddress,
                configParams.mstableSavingManager,
            ]
        ).then(async (mstableYield) => {
            await mstableYield.deployed();

            console.log(
                "MstableYield contract deployed to:",
                mstableYield.address, "\n"
            );

            if (network.name === "mumbai") {
                file.mumbai.mstableYieldAddress = mstableYield.address;
            } else if (network.name === "matic") {
                file.matic.mstableYieldAddress = mstableYield.address;
            } else {
                file.development.mstableYieldAddress = mstableYield.address;
            }

            fs.writeFileSync(
                path.join(__dirname, fileName),
                JSON.stringify(file, null, 2),
            );

            resolve(true);
        });
    });
}

module.exports = { deployMstableYield: main }
