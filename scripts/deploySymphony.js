const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { network } = require("hardhat");
const fileName = "../config/index.json";
const file = require("../config/index.json");
const config = require("../config/index.json");
const globalArgs = require('../config/arguments.json');

const main = () => {
    return new Promise(async (resolve) => {
        let configParams = config.development;
        if (network.name === "matic") {
            configParams = config.matic;
        } else if (network.name === "mumbai") {
            configParams = config.mumbai;
        }

        // Deploy Symphony Contract
        const Symphony = await hre.ethers.getContractFactory("Symphony");

        upgrades.deployProxy(
            Symphony,
            [
                configParams.admin,
                configParams.emergencyAdmin,
                globalArgs.symphony.executionFee,
                configParams.chainlinkOracle,
            ]
        ).then(async (symphony) => {
            await symphony.deployed();

            console.log(
                "Symphony contract deployed to:",
                symphony.address, "\n"
            );

            if (network.name === "mumbai") {
                file.mumbai.symphonyAddress = symphony.address;
            } else if (network.name === "matic") {
                file.matic.symphonyAddress = symphony.address;
            } else {
                file.development.symphonyAddress = symphony.address;
            }

            fs.writeFileSync(
                path.join(__dirname, fileName),
                JSON.stringify(file, null, 2),
            );

            resolve(true);
        });
    });
}

module.exports = { deploySymphony: main }
