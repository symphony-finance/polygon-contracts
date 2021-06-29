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

    // Deploy SushiswapHandler Contract
    const SushiswapHandler = await hre.ethers.getContractFactory("SushiswapHandler");

    const sushiswapHandler = await SushiswapHandler.deploy(
        configParams.sushiswapFactory,
        configParams.sushiswapRouter, // Router
        configParams.wethAddress, // WETH
        configParams.wmaticAddress, // WMATIC
        configParams.sushiswapCodeHash,
        configParams.chainlinkOracle,
    );

    await sushiswapHandler.deployed();
    console.log("Sushiswap Handler deployed to:", sushiswapHandler.address, "\n");

    if (network.name === "mumbai") {
        file.mumbai.sushiswapHandlerAddress = sushiswapHandler.address;
    } else if (network.name === "matic") {
        file.matic.sushiswapHandlerAddress = sushiswapHandler.address;
    } else {
        file.development.sushiswapHandlerAddress = sushiswapHandler.address;
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

    await symphony.addHandler(sushiswapHandler.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
