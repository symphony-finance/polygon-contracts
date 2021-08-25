const fs = require("fs");
const path = require("path");
const hre, { network } = require("hardhat");
const config = require("../config/index.json");
const file = require("../config/index.json");
const fileName = "../config/index.json";

const main = () => {
    return new Promise(async (resolve) => {
        const [deployer] = await ethers.getSigners();

        let configParams = config.mumbai;
        if (network.name === "matic") {
            configParams = config.matic;
        } else if (network.name === "mumbai") {
            configParams = config.mumbai;
        }

        // Deploy Symphony Contract
        const WmaticGateway = await hre.ethers.getContractFactory("WMATICGateway");

        upgrades.deployProxy(
            WmaticGateway,
            [
                configParams.wmaticAddress,
                deployer.address,
                configParams.symphonyAddress,
            ]
        ).then(async (wmaticGateway) => {
            await wmaticGateway.deployed();
            console.log("WMATIC Gateway deployed to:", wmaticGateway.address, "\n");

            if (network.name === "mumbai") {
                file.mumbai.wmaticGateway = wmaticGateway.address;
            } else if (network.name === "matic") {
                file.matic.wmaticGateway = wmaticGateway.address;
            } else {
                file.development.wmaticGateway = treasury.address;
            }

            fs.writeFileSync(
                path.join(__dirname, fileName),
                JSON.stringify(file, null, 2),
            );

            resolve(true);
        });
    })
}

module.exports = { deployWmaticGateway: main }
