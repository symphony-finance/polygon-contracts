const hre = require("hardhat");
const config = require("../config/index.json");

const main = () => {
    return new Promise(async (resolve) => {
        let configParams = config.development;
        if (network.name === "matic") {
            configParams = config.matic;
        } else if (network.name === "mumbai") {
            configParams = config.mumbai;
        }

        // Deploy AaveYield Contract
        const AaveYield = await hre.ethers.getContractFactory("AaveYield");

        upgrades.deployProxy(
            AaveYield,
            [
                configParams.symphonyAddress,
                configParams.admin,
                configParams.aaveLendingPool,
                configParams.aaveProtocolDataProvider,
                configParams.aaveIncentivesController
            ]
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
