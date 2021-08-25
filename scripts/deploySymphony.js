const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { network } = require("hardhat");
const file = require("../config/index.json");
const fileName = "../config/index.json";

const main = (fee) => {
    return new Promise(async (resolve) => {
        const [deployer] = await ethers.getSigners();

        // Deploy Symphony Contract
        const Symphony = await hre.ethers.getContractFactory("Symphony");

        upgrades.deployProxy(
            Symphony,
            [
                deployer.address,
                deployer.address,
                fee, // 40 for 0.4 %
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
