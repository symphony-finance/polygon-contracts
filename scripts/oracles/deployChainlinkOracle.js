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

        // Deploy ChainlinkOracle Contract
        const ChainlinkOracle = await hre.ethers
            .getContractFactory("ChainlinkOracle");

        ChainlinkOracle.deploy(configParams.admin)
            .then(async (chainlinkOracle) => {
                await chainlinkOracle.deployed();

                console.log(
                    "Chainlink Oracle contract deployed to:",
                    chainlinkOracle.address, "\n"
                );

                if (network.name === "mumbai") {
                    file.mumbai.chainlinkOracle = chainlinkOracle.address;
                } else if (network.name === "matic") {
                    file.matic.chainlinkOracle = chainlinkOracle.address;
                } else {
                    file.development.chainlinkOracle = chainlinkOracle.address;
                }

                fs.writeFileSync(
                    path.join(__dirname, fileName),
                    JSON.stringify(file, null, 2),
                );

                resolve(true);
            })
    });
}

module.exports = { deployChainlinkOracle: main }
