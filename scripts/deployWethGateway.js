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

        // Deploy Symphony Contract
        const WethGateway = await hre.ethers.getContractFactory("WETHGateway");

        upgrades.deployProxy(
            WethGateway,
            [
                configParams.wethAddress,
                deployer.address,
                configParams.symphonyAddress,
            ]
        ).then(async (wethGateway) => {
            await wethGateway.deployed();
            console.log("WETH Gateway deployed to:", wethGateway.address, "\n");

            if (network.name === "mumbai") {
                file.mumbai.wethGatewayAddress = wethGateway.address;
            } else if (network.name === "matic") {
                file.matic.wethGatewayAddress = wethGateway.address;
            } else {
                file.development.wethGatewayAddress = wethGateway.address;
            }

            fs.writeFileSync(
                path.join(__dirname, fileName),
                JSON.stringify(file, null, 2),
            );

            resolve(true);
        });
    });
}

module.exports = { deployWethGateway: main }
