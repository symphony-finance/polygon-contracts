const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
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

    // Deploy AaveYield Contract
    const AaveYield = await hre.ethers.getContractFactory("AaveYield");

    const aaveYield = await AaveYield.deploy(
        configParams.symphonyAddress,
        deployer.address,
        configParams.aaveLendingPool,
        configParams.aaveProtocolDataProvider,
    );

    await aaveYield.deployed();

    console.log("AaveYield contract deployed to:", aaveYield.address, "\n");

    if (network.name === "mumbai") {
        file.mumbai.aaveYieldAddress = aaveYield.address;
    } else if (network.name === "mainnet") {
        file.mainnet.aaveYieldAddress = aaveYield.address;
    } else {
        file.development.aaveYieldAddress = aaveYield.address;
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
