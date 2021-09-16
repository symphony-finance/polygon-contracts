const fs = require("fs");
const path = require("path");
const { network } = require("hardhat");
const fileName = "../config/index.json";
const file = require("../config/index.json");
const globalArgs = require('../config/arguments.json');

const main = async () => {
    let networkName = "rinkeby";
    if (network.name === "matic") {
        networkName = network.name;
    }

    const timelockArgs = globalArgs.timelock[networkName];
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
        file.matic.timelockAddress = timelock.address;
    } else {
        file.development.timelockAddress = timelock.address;
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
