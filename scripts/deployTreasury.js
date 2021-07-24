const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { network } = require("hardhat");
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

        // Deploy Treasury Contract
        const Treasury = await hre.ethers.getContractFactory("Treasury");

        Treasury.deploy(deployer.address)
            .then(async (treasury) => {

                await treasury.deployed();
                console.log("Treasury deployed to:", treasury.address, "\n");

                if (network.name === "mumbai") {
                    file.mumbai.treasury = treasury.address;
                } else if (network.name === "matic") {
                    file.matic.treasury = treasury.address;
                } else {
                    file.development.treasury = treasury.address;
                }

                fs.writeFileSync(
                    path.join(__dirname, fileName),
                    JSON.stringify(file, null, 2),
                );

                resolve(true);
            });
    });
}

module.exports = { deployTreasury: main }
