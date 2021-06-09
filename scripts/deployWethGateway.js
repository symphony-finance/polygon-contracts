const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { network } = require("hardhat");
const config = require("../config/index.json");
const file = require("../config/index.json");
const fileName = "../config/index.json";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log(
        "Deploying contracts with the account:",
        deployer.address
    );

    let configParams = config.development;
    if (network.name === "mainnet") {
        configParams = config.mainnet;
    } else if (network.name === "mumbai") {
        configParams = config.mumbai;
    }

    // Deploy Symphony Contract
    const WethGateway = await hre.ethers.getContractFactory("WETHGateway");

    const wethGateway = await upgrades.deployProxy(
        WethGateway,
        [
            configParams.wethAddress,
            deployer.address,
            configParams.symphonyAddress,
        ]
    );

    await wethGateway.deployed();
    console.log("WETH Gateway deployed to:", wethGateway.address, "\n");

    if (network.name === "mumbai") {
        file.mumbai.wethGatewayAddress = wethGateway.address;
    } else if (network.name === "mainnet") {
        file.mainnet.wethGatewayAddress = wethGateway.address;
    } else {
        file.development.wethGatewayAddress = wethGateway.address;
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
