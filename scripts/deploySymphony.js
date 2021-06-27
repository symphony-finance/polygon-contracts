const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { network } = require("hardhat");
const file = require("../config/index.json");
const fileName = "../config/index.json";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log(
        "Deploying contracts with the account:",
        deployer.address
    );

    // Deploy Symphony Contract
    const Symphony = await hre.ethers.getContractFactory("Symphony");

    const symphony = await upgrades.deployProxy(
        Symphony,
        [
            deployer.address,
            10, // 0.1 %
            // 3000, // 30%
            0,
        ]
    );

    await symphony.deployed();
    console.log("Symphony contract deployed to:", symphony.address, "\n");

    if (network.name === "mumbai") {
        file.mumbai.symphonyAddress = symphony.address;
    } else if (network.name === "mainnet") {
        file.mainnet.symphonyAddress = symphony.address;
    } else {
        file.development.symphonyAddress = symphony.address;
    }

    fs.writeFileSync(
        path.join(__dirname, fileName),
        JSON.stringify(file, null, 2),
    );
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
