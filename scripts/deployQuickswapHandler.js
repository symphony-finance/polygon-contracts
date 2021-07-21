const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { network } = require("hardhat");
const config = require("../config/index.json");
const file = require("../config/index.json");
const fileName = "../config/index.json";
const SymphonyArtifacts = require(
    '../artifacts/contracts/Symphony.sol/Symphony.json'
);

async function main() {
    let configParams = config.development;
    if (network.name === "matic") {
        configParams = config.matic;
    } else if (network.name === "mumbai") {
        configParams = config.mumbai;
    }

    // Deploy QuickswapHandler Contract
    const QuickswapHandler = await hre.ethers.getContractFactory("QuickswapHandler");

    const quickswapHandler = await QuickswapHandler.deploy(
        configParams.quickswapRouter, // Router
        configParams.wethAddress, // WETH
        configParams.wmaticAddress, // WMATIC
        configParams.quickswapCodeHash,
        configParams.chainlinkOracle,
    );

    await quickswapHandler.deployed();
    console.log("Quickswap Handler deployed to:", quickswapHandler.address, "\n");

    if (network.name === "mumbai") {
        file.mumbai.quickswapHandlerAddress = quickswapHandler.address;
    } else if (network.name === "matic") {
        file.matic.quickswapHandlerAddress = quickswapHandler.address;
    } else {
        file.development.quickswapHandlerAddress = quickswapHandler.address;
    }

    fs.writeFileSync(
        path.join(__dirname, fileName),
        JSON.stringify(file, null, 2),
    );

    const [deployer] = await ethers.getSigners();

    // Set Handler In Symphony Contract
    const symphony = new ethers.Contract(
        configParams.symphonyAddress,
        SymphonyArtifacts.abi,
        deployer
    );

    await symphony.addHandler(quickswapHandler.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
