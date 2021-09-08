const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { network } = require("hardhat");
const fileName = "../config/index.json";
const file = require("../config/index.json");
const config = require("../config/index.json");
const SymphonyArtifacts = require(
    '../artifacts/contracts/Symphony.sol/Symphony.json'
);

const main = () => {
    return new Promise(async (resolve) => {
        let configParams = config.development;
        if (network.name === "matic") {
            configParams = config.matic;
        } else if (network.name === "mumbai") {
            configParams = config.mumbai;
        }

        // Deploy SushiswapHandler Contract
        const SushiswapHandler = await hre.ethers
            .getContractFactory("SushiswapHandler");

        SushiswapHandler.deploy(
            configParams.sushiswapRouter, // Router
            configParams.sushiswapCodeHash,
            configParams.chainlinkOracle,
            configParams.symphonyAddress
        ).then(async (sushiswapHandler) => {
            await sushiswapHandler.deployed();

            console.log(
                "Sushiswap Handler deployed to:",
                sushiswapHandler.address, "\n"
            );

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
            resolve(true);
        });
    })
}

module.exports = { deploySushiswapHandler: main }
