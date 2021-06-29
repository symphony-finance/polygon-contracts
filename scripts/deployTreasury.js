const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { network } = require("hardhat");
const config = require("../config/index.json");
const file = require("../config/index.json");
const fileName = "../config/index.json";

async function main() {
    const [deployer] = await ethers.getSigners();

    let configParams = config.development;
    if (network.name === "matic") {
        configParams = config.matic;
    } else if (network.name === "mumbai") {
        configParams = config.mumbai;
    }

    // Deploy Treasury Contract
    const Treasury = await hre.ethers.getContractFactory("Treasury");

    const treasury = await Treasury.deploy(deployer.address);

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
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
