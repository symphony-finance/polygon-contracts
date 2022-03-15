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

        // Deploy ParaswapHandler Contract
        const ParaswapHandler = await hre.ethers
            .getContractFactory("ParaswapHandler");

        ParaswapHandler.deploy(
            configParams.yoloAddress,
        ).then(async (paraswapHandler) => {
            await paraswapHandler.deployed();

            console.log(
                "Paraswap Handler deployed to:",
                paraswapHandler.address, "\n"
            );

            if (network.name === "mumbai") {
                file.mumbai.paraswapHandlerAddress = paraswapHandler.address;
            } else if (network.name === "matic") {
                file.matic.paraswapHandlerAddress = paraswapHandler.address;
            } else {
                file.development.paraswapHandlerAddress = paraswapHandler.address;
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

            const tx = await yolo.addHandler(paraswapHandler.address);
            await tx.wait();

            resolve(true);
        });
    })
}

module.exports = { deployParaswapHandler: main }
