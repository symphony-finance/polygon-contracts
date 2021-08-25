const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const file = require("../config/index.json");
const fileName = "../config/index.json";

const main = () => {
    return new Promise(async (resolve) => {
        const [deployer] = await ethers.getSigners();

        // Deploy ChainlinkOracle Contract
        const ChainlinkOracle = await hre.ethers
            .getContractFactory("ChainlinkOracle");

        ChainlinkOracle.deploy(deployer.address)
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
