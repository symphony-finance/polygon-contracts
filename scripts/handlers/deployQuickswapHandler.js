const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { network } = require("hardhat");
const fileName = "../../config/index.json";
const file = require("../../config/index.json");
const config = require("../../config/index.json");
const YoloArtifacts = require('../../artifacts/contracts/Yolo.sol/Yolo.json');

const main = () => {
    return new Promise(async (resolve) => {
        let configParams = config.development;
        if (network.name === "matic") {
            configParams = config.matic;
        } else if (network.name === "mumbai") {
            configParams = config.mumbai;
        }

        // Deploy QuickswapHandler Contract
        const QuickswapHandler = await hre.ethers
            .getContractFactory("QuickswapHandler");

        await QuickswapHandler.deploy(
            configParams.quickswapRouter, // Router
            configParams.wethAddress, // WETH
            configParams.wmaticAddress, // WMATIC
            configParams.quickswapCodeHash,
            configParams.yoloAddress
        ).then(async (quickswapHandler) => {
            await quickswapHandler.deployed();

            console.log(
                "Quickswap Handler deployed to:",
                quickswapHandler.address, "\n"
            );

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

            // Set Handler In Yolo Contract
            const yolo = new ethers.Contract(
                configParams.yoloAddress,
                YoloArtifacts.abi,
                deployer
            );

            const tx = await yolo.addHandler(quickswapHandler.address);
            await tx.wait();

            resolve(true);
        });
    });
}

module.exports = { deployQuickswapHandler: main }
