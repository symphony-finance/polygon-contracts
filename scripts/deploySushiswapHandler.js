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
    if (network.name === "mainnet") {
        configParams = config.mainnet;
    } else if (network.name === "mumbai") {
        configParams = config.mumbai;
    }

    // Deploy SushiswapHandler Contract
    const SushiswapHandler = await hre.ethers.getContractFactory("SushiswapHandler");

    const sushiswapHandler = await SushiswapHandler.deploy(
        configParams.sushiswapFactory,
        "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506", // Router
        // "0x5B67676a984807a212b1c59eBFc9B3568a474F0a", // WETH
        "0x6aA61E359301b2E9a3c3118d409834BDc8b10dC4", // WETH
        "0xBb9DF44E381e3d5D82717BC87901FbBEF2eFE361", // WMATIC
        configParams.sushiswapCodeHash,
        configParams.chainlinkOracle,
    );

    await sushiswapHandler.deployed();
    console.log("Sushiswap Handler deployed to:", sushiswapHandler.address, "\n");

    if (network.name === "mumbai") {
        file.mumbai.sushiswapHandlerAddress = sushiswapHandler.address;
    } else if (network.name === "mainnet") {
        file.mainnet.sushiswapHandlerAddress = sushiswapHandler.address;
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
