const hre = require("hardhat");
const { network } = require("hardhat");
const config = require("../config/index.json");

const main = () => {
    return new Promise(async (resolve) => {
        const [deployer] = await ethers.getSigners();
        console.log(
            "Deploying contracts with the account:",
            deployer.address, "\n"
        );

        let configParams = config.development;
        if (network.name === "matic") {
            configParams = config.matic;
        } else if (network.name === "mumbai") {
            configParams = config.mumbai;
        }

        // rinkeby addr: 0xfacde2a1a180c55214887c2961f259c73d78e072
        const symphonyTokenAddr = configParams.symphonyToken;

        // Deploy Reward Contract
        // rinkeby addr = 0x0e9E8c508ea4caCC18bfa41244ecF252482D23aF
        const Reward = await hre.ethers.getContractFactory("Reward");

        upgrades.deployProxy(
            Reward,
            [
                symphonyTokenAddr,
                configParams.admin,
            ]
        ).then(async (reward) => {
            await reward.deployed();

            console.log(
                "Reward contract deployed to:",
                reward.address, "\n"
            );

            resolve(true);
        });
    });
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
