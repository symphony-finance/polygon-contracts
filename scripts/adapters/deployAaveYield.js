const hre = require("hardhat");
const config = require("../../config/index.json");

const main = (tokenAddress) => {
    return new Promise(async (resolve) => {
        let configParams = config.development;
        if (network.name === "matic") {
            configParams = config.matic;
        } else if (network.name === "mumbai") {
            configParams = config.mumbai;
        }

        // Deploy AaveYield Contract
        const AaveYield = await hre.ethers.getContractFactory("AaveYield");

        AaveYield.deploy(
            configParams.yoloAddress,
            configParams.emergencyAdmin,
            tokenAddress,
            configParams.aaveLendingPool,
            configParams.aaveIncentivesController
        ).then(async (aaveYield) => {
            await aaveYield.deployed();

            console.log(
                "AaveYield contract deployed to:",
                aaveYield.address, "\n"
            );

            resolve(aaveYield.address);
        });
    })
}

module.exports = { deployAaveYield: main }
