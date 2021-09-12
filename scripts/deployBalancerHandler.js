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

        // Deploy BalancerHandler Contract
        const BalancerHandler = await hre.ethers
            .getContractFactory("BalancerHandler");

        BalancerHandler.deploy(
            configParams.balancerVault,
            configParams.symphonyAddress,
        ).then(async (balancerHandler) => {
            await balancerHandler.deployed();

            console.log(
                "Balancer Handler deployed to:",
                balancerHandler.address, "\n"
            );

            if (network.name === "mumbai") {
                file.mumbai.balancerHandlerAddress = balancerHandler.address;
            } else if (network.name === "matic") {
                file.matic.balancerHandlerAddress = balancerHandler.address;
            } else {
                file.development.balancerHandlerAddress = balancerHandler.address;
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

            await symphony.addHandler(balancerHandler.address);
            resolve(true);
        });
    })
}

module.exports = { deployBalancerHandler: main }
