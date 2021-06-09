const hre = require("hardhat");
const { expect } = require("chai");
const config = require("../config/index.json");
const { default: BigNumber } = require("bignumber.js");
const IERC20Artifacts = require(
    "../artifacts/contracts/mocks/TestERC20.sol/TestERC20.json"
);
const SymphonyArtifacts = require(
    "../artifacts/contracts/Symphony.sol/Symphony.json"
);
const AaveYieldArtifacts = require(
    "../artifacts/contracts/adapters/AaveYield.sol/AaveYield.json"
);

const daiAddress = "0x6b175474e89094c44da98b954eedeac495271d0f";
const usdcAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

describe("Execute Order Test", function () {
    it("Should execute order", async function () {
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
        });

        const deployer = await ethers.provider.getSigner(
            "0xAb7677859331f95F25A3e7799176f7239feb5C44"
        );
        deployer.address = deployer._address;

        console.log(
            "Deploying contracts with the account:",
            deployer.address, "\n"
        );

        let configParams = config.mainnet;
        if (network.name === "mainnet") {
            configParams = config.mainnet;
        } else if (network.name === "mumbai") {
            configParams = config.mumbai;
        }

        // Create USDC contract instance
        const usdcContract = new ethers.Contract(
            usdcAddress,
            IERC20Artifacts.abi,
            deployer
        );

        // Create DAI contract instance
        const daiContract = new ethers.Contract(
            daiAddress,
            IERC20Artifacts.abi,
            deployer
        );

        // Deploy Symphony Contract
        const Symphony = await ethers.getContractFactory("Symphony");

        let symphony = await upgrades.deployProxy(
            Symphony,
            [
                deployer.address,
                1,
                3000
            ]
        );

        await symphony.deployed();
        console.log("Symphony contract deployed to:", symphony.address, "\n");

        symphony = new ethers.Contract(
            symphony.address,
            SymphonyArtifacts.abi,
            deployer
        );

        // Deploy AaveYield Contract
        const AaveYield = await hre.ethers.getContractFactory("AaveYield");

        let aaveYield = await AaveYield.deploy(
            symphony.address,
            deployer.address,
            configParams.aaveLendingPool,
            configParams.aaveProtocolDataProvider,
        );

        await aaveYield.deployed();
        console.log("AaveYield contract deployed to:", aaveYield.address, "\n");

        aaveYield = new ethers.Contract(
            aaveYield.address,
            AaveYieldArtifacts.abi,
            deployer
        );

        await symphony.updateTokenStrategy(daiAddress, aaveYield.address);
        console.log("Updated Strategy: ", await symphony.strategy(daiAddress));

        const SushiswapHandler = await ethers.getContractFactory("SushiswapHandler");

        sushiswapHandler = await SushiswapHandler.deploy(
            configParams.sushiswapFactory,
            configParams.wethAddress,
            configParams.sushiswapCodeHash,
        );

        await sushiswapHandler.deployed();
        console.log("Sushiswap Handler deployed to:", sushiswapHandler.address, "\n");

        // Add Handler
        await symphony.addHandler(sushiswapHandler.address);

        const approveAmount = new BigNumber(100)
            .times(
                new BigNumber(10)
                    .exponentiatedBy(new BigNumber(18))
            )
            .toString();

        await daiContract.approve(symphony.address, approveAmount);
        await usdcContract.approve(symphony.address, approveAmount);

        const inputAmount = new BigNumber(10).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(18))
        ).toString();

        const minReturnAmount = new BigNumber(15).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();

        const stoplossAmount = new BigNumber(9.99).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();

        // Create Order
        const tx = await symphony.createOrder(
            deployer.address,
            daiAddress,
            usdcAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount
        );

        const receipt = await tx.wait();
        const events = receipt.events.filter((x) => { return x.event == "OrderCreated" });

        const orderId = events[0].args[0];
        const orderData = events[0].args[1];

        const usdcBalBeforeExecute = await usdcContract.balanceOf(deployer.address);
        console.log("USDC Balance Before Execution: ", usdcBalBeforeExecute.toString());

        // Execute Order
        await symphony.executeOrder(orderId, orderData, sushiswapHandler.address, 0x0);

        const usdcBalAfterExecute = await usdcContract.balanceOf(deployer.address);

        console.log("USDC Balance After Execution: ", usdcBalAfterExecute.toString());
        console.log("Balance Received After Swap: ", usdcBalAfterExecute - usdcBalBeforeExecute);

        expect(Number(usdcBalAfterExecute)).to.be.greaterThanOrEqual(Number(usdcBalBeforeExecute));
    });

    it("Should execute order with withdrawing from strategy", async function () {
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
        });

        const deployer = await ethers.provider.getSigner(
            "0xAb7677859331f95F25A3e7799176f7239feb5C44"
        );
        deployer.address = deployer._address;

        let configParams = config.mainnet;
        if (network.name === "mainnet") {
            configParams = config.mainnet;
        } else if (network.name === "mumbai") {
            configParams = config.mumbai;
        }

        // Create USDC contract instance
        const usdcContract = new ethers.Contract(
            usdcAddress,
            IERC20Artifacts.abi,
            deployer
        );

        // Create DAI contract instance
        const daiContract = new ethers.Contract(
            daiAddress,
            IERC20Artifacts.abi,
            deployer
        );

        // Deploy Symphony Contract
        const Symphony = await ethers.getContractFactory("Symphony");

        let symphony = await upgrades.deployProxy(
            Symphony,
            [
                deployer.address,
                1,
                3000
            ]
        );

        await symphony.deployed();
        console.log("Symphony contract deployed to:", symphony.address, "\n");

        symphony = new ethers.Contract(
            symphony.address,
            SymphonyArtifacts.abi,
            deployer
        );

        // Deploy AaveYield Contract
        const AaveYield = await hre.ethers.getContractFactory("AaveYield");

        let aaveYield = await AaveYield.deploy(
            symphony.address,
            deployer.address,
            configParams.aaveLendingPool,
            configParams.aaveProtocolDataProvider,
        );

        await aaveYield.deployed();
        console.log("AaveYield contract deployed to:", aaveYield.address, "\n");

        aaveYield = new ethers.Contract(
            aaveYield.address,
            AaveYieldArtifacts.abi,
            deployer
        );

        await symphony.updateTokenStrategy(daiAddress, aaveYield.address);
        console.log("Updated Strategy: ", await symphony.strategy(daiAddress));

        const SushiswapHandler = await ethers.getContractFactory("SushiswapHandler");

        sushiswapHandler = await SushiswapHandler.deploy(
            configParams.sushiswapFactory,
            configParams.wethAddress,
            configParams.sushiswapCodeHash,
        );

        await sushiswapHandler.deployed();
        console.log("Sushiswap Handler deployed to:", sushiswapHandler.address, "\n");

        // Add Handler
        await symphony.addHandler(sushiswapHandler.address);

        const approveAmount = new BigNumber(100)
            .times(
                new BigNumber(10)
                    .exponentiatedBy(new BigNumber(18))
            )
            .toString();

        await daiContract.approve(symphony.address, approveAmount);
        await usdcContract.approve(symphony.address, approveAmount);

        const inputAmount = new BigNumber(10).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(18))
        ).toString();

        const minReturnAmount = new BigNumber(15).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();

        const stoplossAmount = new BigNumber(9.99).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();

        // Create Order
        const tx = await symphony.createOrder(
            deployer.address,
            daiAddress,
            usdcAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount
        );

        const receipt = await tx.wait();
        const events = receipt.events.filter((x) => { return x.event == "OrderCreated" });

        const orderId = events[0].args[0];
        const orderData = events[0].args[1];

        const usdcBalBeforeExecute = await usdcContract.balanceOf(deployer.address);
        console.log("USDC Balance Before Execution: ", usdcBalBeforeExecute.toString());

        // Rebalance Asset
        await symphony.rebalanceAsset(daiAddress);

        // Execute Order
        await symphony.executeOrder(orderId, orderData, sushiswapHandler.address, 0x0);

        const usdcBalAfterExecute = await usdcContract.balanceOf(deployer.address);

        console.log("USDC Balance After Execution: ", usdcBalAfterExecute.toString());
        console.log("Balance Received After Swap: ", usdcBalAfterExecute - usdcBalBeforeExecute);

        expect(Number(usdcBalAfterExecute)).to.be.greaterThan(Number(usdcBalBeforeExecute));
    });
});
