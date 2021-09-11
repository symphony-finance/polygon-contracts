const fs = require("fs");
const { network } = require("hardhat");
const arguments = require('../config/arguments.json');
const fileName = "../config/index.json";
const file = require("../config/index.json");

const main = async () => {
    const networkName = "rinkeby";
    if (network.name === "mumbai") {
        networkName = network.name;
    }

    const timelockArgs = arguments.timelock[networkName];
    var delayTime = timelockArgs.minimumDelay;
    var proposersArray = timelockArgs.proposers;
    var executorsArray = timelockArgs.executors;

    const [deployer] = await ethers.getSigners();

    console.log(
        "Deploying contracts with the account:",
        deployer.address, "\n"
    );

    const Timelock = await ethers.getContractFactory("Timelock");

    const timelock = await Timelock.deploy(
        delayTime,
        proposersArray,
        executorsArray
    );

    await timelock.deployed();

    console.log(
        "Timelock contract deployed to:",
        timelock.address, "\n"
    );

    if (network.name === "matic") {
        file.matic.timelockAddr = timelock.address;
    } else {
        file.development.timelockAddr = timelock.address;
    }

    fs.writeFileSync(
        path.join(__dirname, fileName),
        JSON.stringify(file, null, 2),
    );
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
