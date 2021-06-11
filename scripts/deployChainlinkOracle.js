const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const file = require("../config/index.json");
const fileName = "../config/index.json";

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log(
        "Deploying contracts with the account:",
        deployer.address
    );

    // Deploy ChainlinkOracle Contract
    const ChainlinkOracle = await hre.ethers
        .getContractFactory("ChainlinkOracle");

    const chainlinkOracle = await ChainlinkOracle.deploy(deployer.address);

    await chainlinkOracle.deployed();

    console.log(
        "Chainlink Oracle contract deployed to:",
        chainlinkOracle.address, "\n"
    );

    if (network.name === "mumbai") {
        file.mumbai.chainlinkOracle = chainlinkOracle.address;
    } else if (network.name === "mainnet") {
        file.mainnet.chainlinkOracle = chainlinkOracle.address;
    } else {
        file.development.chainlinkOracle = chainlinkOracle.address;
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
