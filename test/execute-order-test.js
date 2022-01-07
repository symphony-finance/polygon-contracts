const hre = require("hardhat");
const { expect } = require("chai");
const config = require("../config/index.json");
const { BigNumber: EthersBN } = require("ethers");
const { default: BigNumber } = require("bignumber.js");
const { time, expectRevert } = require("@openzeppelin/test-helpers");
const IERC20Artifacts = require(
    "../artifacts/contracts/mocks/TestERC20.sol/TestERC20.json"
);
const YoloArtifacts = require(
    "../artifacts/contracts/Yolo.sol/Yolo.json"
);
const AaveYieldArtifacts = require(
    "../artifacts/contracts/adapters/AaveYield.sol/AaveYield.json"
);
const ChainlinkArtifacts = require(
    "../artifacts/contracts/oracles/ChainlinkOracle.sol/ChainlinkOracle.json"
);
const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants");

const configParams = config.mainnet;
const daiAddress = "0x6b175474e89094c44da98b954eedeac495271d0f";
const usdcAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

const recipient = "0xAb7677859331f95F25A3e7799176f7239feb5C44";
const executor = "0xAb7677859331f95F25A3e7799176f7239feb5C44";

const totalFeePercent = 20 // 0.2%
const executorFeePercent = 15; // 0.15%;
const protocolFeePercent = 5; // 0.05%

let inputAmount = new BigNumber(10)
    .times(new BigNumber(10).exponentiatedBy(new BigNumber(18)));
let executionFee = inputAmount
    .multipliedBy(new BigNumber(executorFeePercent / 100)).toString()
inputAmount = inputAmount.toString()

const minReturnAmount = new BigNumber(15).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(6))
).toString();

const stoplossAmount = new BigNumber(11).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(6))
).toString();

const approveAmount = new BigNumber(100)
    .times(
        new BigNumber(10)
            .exponentiatedBy(new BigNumber(18))
    )
    .toString();

describe("Execute Order Test", () => {
    it("Should execute order with Sushiswap Handler & Aave Yield", async () => {
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
        });

        const deployer = await ethers.provider.getSigner(
            "0xAb7677859331f95F25A3e7799176f7239feb5C44"
        );
        deployer.address = deployer._address;

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

        // Deploy Chainlink Oracle
        const ChainlinkOracle = await hre.ethers.getContractFactory("ChainlinkOracle");
        let chainlinkOracle = await ChainlinkOracle.deploy(deployer.address);

        await chainlinkOracle.deployed();

        chainlinkOracle = new ethers.Contract(
            chainlinkOracle.address,
            ChainlinkArtifacts.abi,
            deployer
        );
        await chainlinkOracle.updateTokenFeeds(
            [usdcAddress],
            ["0x986b5E1e1755e3C2440e960477f25201B0a8bbD4"], // USDC-ETH
        );

        await chainlinkOracle.updateTokenFeeds(
            [daiAddress],
            ["0x773616E4d11A78F511299002da57A0a94577F1f4"], // DAI-ETH
        );

        await chainlinkOracle.updatePriceSlippage(100);

        // Deploy Yolo Contract
        const Yolo = await ethers.getContractFactory("Yolo");

        let yolo = await upgrades.deployProxy(
            Yolo,
            [
                deployer.address,
                deployer.address,
                totalFeePercent,
                chainlinkOracle.address,
            ]
        );

        await yolo.deployed();

        yolo = new ethers.Contract(
            yolo.address,
            YoloArtifacts.abi,
            deployer
        );

        // Deploy AaveYield Contract
        const AaveYield = await hre.ethers.getContractFactory("AaveYield");

        let aaveYield = await AaveYield.deploy(
            yolo.address,
            deployer.address,
            daiAddress,
            configParams.aaveLendingPool,
            configParams.aaveIncentivesController
        );

        await aaveYield.deployed();

        aaveYield = new ethers.Contract(
            aaveYield.address,
            AaveYieldArtifacts.abi,
            deployer
        );

        await yolo.setStrategy(daiAddress, aaveYield.address);
        await yolo.updateTokenBuffer(daiAddress, 4000);

        // Deploy Sushiswap Handler
        const SushiswapHandler = await ethers.getContractFactory("SushiswapHandler");

        const sushiswapHandler = await SushiswapHandler.deploy(
            configParams.sushiswapRouter,
            configParams.wethAddress,
            configParams.wmaticAddress,
            configParams.sushiswapCodeHash,
            yolo.address
        );

        await sushiswapHandler.deployed();

        await yolo.addHandler(sushiswapHandler.address);
        await yolo.addWhitelistToken(daiAddress);

        await daiContract.approve(yolo.address, approveAmount);

        // Create Order
        const tx = await yolo.createOrder(
            recipient,
            daiAddress,
            usdcAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount,
            executor,
            executionFee,
        );

        const receipt = await tx.wait();
        const events = receipt.events.filter((x) => { return x.event == "OrderCreated" });

        const orderId = events[0].args[0];
        const orderData = events[0].args[1];

        const daiBalBeforeExecute = await daiContract.balanceOf(deployer.address);
        const usdcBalBeforeExecute = await usdcContract.balanceOf(deployer.address);

        // Advancing 100 blocks
        for (let i = 0; i < 100; ++i) {
            await time.advanceBlock();
        };

        const oracleResult = await chainlinkOracle.get(
            daiAddress,
            usdcAddress,
            new BigNumber(inputAmount).minus(new BigNumber(executionFee)).toString()
        );
        const oracleAmount = Number(oracleResult.amountOutWithSlippage);

        const amountOutMin = oracleAmount <= Number(stoplossAmount) ||
            oracleAmount > Number(minReturnAmount)
            ? oracleAmount
            : Number(minReturnAmount);

        const contractBal = await daiContract.balanceOf(yolo.address);
        const totalTokens = await yolo.callStatic.getTotalTokens(
            daiAddress, contractBal, aaveYield.address
        );
        const depositPlusYield = totalTokens; // as there is only one order
        const yieldEarned = depositPlusYield.sub(EthersBN.from(inputAmount));

        // Execute Order
        await yolo.executeOrder(orderId, orderData, sushiswapHandler.address, 0x0);

        const daiBalAfterExecute = await daiContract.balanceOf(deployer.address);
        const usdcBalAfterExecute = await usdcContract.balanceOf(deployer.address);

        expect(Number(usdcBalAfterExecute)).to.be.greaterThanOrEqual(
            Number(usdcBalBeforeExecute) + Number(amountOutMin)
        );

        expect(Number(daiBalAfterExecute))
            .to.be.greaterThanOrEqual(
                Number(daiBalBeforeExecute) + Number(yieldEarned)
            );
    });

    it("Should execute existing order if strategy removed", async () => {
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
        });

        const deployer = await ethers.provider.getSigner(
            "0xAb7677859331f95F25A3e7799176f7239feb5C44"
        );
        deployer.address = deployer._address;

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

        // Deploy Chainlink Oracle
        const ChainlinkOracle = await hre.ethers.getContractFactory("ChainlinkOracle");
        let chainlinkOracle = await ChainlinkOracle.deploy(deployer.address);

        await chainlinkOracle.deployed();

        chainlinkOracle = new ethers.Contract(
            chainlinkOracle.address,
            ChainlinkArtifacts.abi,
            deployer
        );
        await chainlinkOracle.updateTokenFeeds(
            [usdcAddress],
            ["0x986b5E1e1755e3C2440e960477f25201B0a8bbD4"], // USDC-ETH
        );

        await chainlinkOracle.updateTokenFeeds(
            [daiAddress],
            ["0x773616E4d11A78F511299002da57A0a94577F1f4"], // DAI-ETH
        );

        await chainlinkOracle.updatePriceSlippage(100);

        // Deploy Yolo Contract
        const Yolo = await ethers.getContractFactory("Yolo");

        let yolo = await upgrades.deployProxy(
            Yolo,
            [
                deployer.address,
                deployer.address,
                totalFeePercent,
                chainlinkOracle.address,
            ]
        );

        await yolo.deployed();
        yolo = new ethers.Contract(
            yolo.address,
            YoloArtifacts.abi,
            deployer
        );

        // Deploy AaveYield Contract
        const AaveYield = await hre.ethers.getContractFactory("AaveYield");

        let aaveYield = await AaveYield.deploy(
            yolo.address,
            deployer.address,
            daiAddress,
            configParams.aaveLendingPool,
            configParams.aaveIncentivesController
        );

        await aaveYield.deployed();

        aaveYield = new ethers.Contract(
            aaveYield.address,
            AaveYieldArtifacts.abi,
            deployer
        );

        await yolo.setStrategy(daiAddress, aaveYield.address);

        // Deploy Sushiswap Handler
        const SushiswapHandler = await ethers.getContractFactory("SushiswapHandler");

        const sushiswapHandler = await SushiswapHandler.deploy(
            configParams.sushiswapRouter,
            configParams.wethAddress,
            configParams.wmaticAddress,
            configParams.sushiswapCodeHash,
            yolo.address
        );

        await sushiswapHandler.deployed();

        // Add Handler
        await yolo.addHandler(sushiswapHandler.address);

        const approveAmount = new BigNumber(100)
            .times(
                new BigNumber(10)
                    .exponentiatedBy(new BigNumber(18))
            )
            .toString();

        await daiContract.approve(yolo.address, approveAmount);

        await yolo.addWhitelistToken(daiAddress);

        const inputAmount1 = new BigNumber(inputAmount)
            .plus(new BigNumber(executionFee)).toString();

        // Create Order
        const tx = await yolo.createOrder(
            recipient,
            daiAddress,
            usdcAddress,
            inputAmount1,
            minReturnAmount,
            stoplossAmount,
            executor,
            executionFee,
        );

        const receipt = await tx.wait();
        const events = receipt.events.filter((x) => { return x.event == "OrderCreated" });

        const orderId = events[0].args[0];
        const orderData = events[0].args[1];

        // Remove yield strategy
        await yolo.migrateStrategy(daiAddress, ZERO_ADDRESS);

        const usdcBalBeforeExecute = await usdcContract.balanceOf(deployer.address);

        // Execute Order
        await yolo.executeOrder(orderId, orderData, sushiswapHandler.address, 0x0);

        const usdcBalAfterExecute = await usdcContract.balanceOf(deployer.address);

        const expectedReturn = new BigNumber(9.9).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();
        expect(Number(usdcBalAfterExecute)).to.be.greaterThanOrEqual(
            Number(usdcBalBeforeExecute) + Number(expectedReturn)
        );
    });

    it("Should execute order if MATIC is the output token", async () => {
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
        });

        const deployer = await ethers.provider.getSigner(
            "0xAb7677859331f95F25A3e7799176f7239feb5C44"
        );
        deployer.address = deployer._address;

        // Create DAI contract instance
        const daiContract = new ethers.Contract(
            daiAddress,
            IERC20Artifacts.abi,
            deployer
        );

        // Deploy Chainlink Oracle
        const ChainlinkOracle = await hre.ethers.getContractFactory("ChainlinkOracle");
        let chainlinkOracle = await ChainlinkOracle.deploy(deployer.address);

        await chainlinkOracle.deployed();

        chainlinkOracle = new ethers.Contract(
            chainlinkOracle.address,
            ChainlinkArtifacts.abi,
            deployer
        );
        await chainlinkOracle.updateTokenFeeds(
            [daiAddress],
            ["0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9"], // DAI-USD
        );

        await chainlinkOracle.updateTokenFeeds(
            [configParams.wethAddress],
            ["0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419"], // ETH-USD
        );

        await chainlinkOracle.updatePriceSlippage(100);

        // Deploy Yolo Contract
        const Yolo = await ethers.getContractFactory("Yolo");

        let yolo = await upgrades.deployProxy(
            Yolo,
            [
                deployer.address,
                deployer.address,
                totalFeePercent,
                chainlinkOracle.address,
            ]
        );

        await yolo.deployed();

        yolo = new ethers.Contract(
            yolo.address,
            YoloArtifacts.abi,
            deployer
        );

        // Deploy Treasury Contract
        const Treasury = await hre.ethers.getContractFactory("Treasury");
        const treasury = await upgrades.deployProxy(
            Treasury,
            [deployer.address],
        );
        await treasury.deployed();

        await yolo.updateTreasury(treasury.address);
        await yolo.updateProtocolFee(protocolFeePercent);

        // Deploy AaveYield Contract
        const AaveYield = await hre.ethers.getContractFactory("AaveYield");

        let aaveYield = await AaveYield.deploy(
            yolo.address,
            deployer.address,
            daiAddress,
            configParams.aaveLendingPool,
            configParams.aaveIncentivesController
        );

        await aaveYield.deployed();

        aaveYield = new ethers.Contract(
            aaveYield.address,
            AaveYieldArtifacts.abi,
            deployer
        );

        await yolo.setStrategy(daiAddress, aaveYield.address);

        // Deploy Sushiswap Handler
        const SushiswapHandler = await ethers.getContractFactory("SushiswapHandler");

        const sushiswapHandler = await SushiswapHandler.deploy(
            configParams.sushiswapRouter,
            configParams.wethAddress,
            configParams.wmaticAddress,
            configParams.sushiswapCodeHash,
            yolo.address
        );

        await sushiswapHandler.deployed();

        // Add Handler
        await yolo.addHandler(sushiswapHandler.address);

        await daiContract.approve(yolo.address, approveAmount);

        await yolo.addWhitelistToken(daiAddress);

        // Create Order
        const tx = await yolo.createOrder(
            recipient,
            daiAddress,
            configParams.wethAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount,
            executor,
            executionFee,
        );

        const receipt = await tx.wait();
        const events = receipt.events.filter((x) => { return x.event == "OrderCreated" });

        const orderId = events[0].args[0];
        const orderData = events[0].args[1];

        const daiBalBeforeExecute = await daiContract.balanceOf(deployer.address);

        // Advancing 100 blocks
        for (let i = 0; i < 100; ++i) {
            await time.advanceBlock();
        };

        const contractBal = await daiContract.balanceOf(yolo.address);
        const totalTokens = await yolo.callStatic.getTotalTokens(
            daiAddress, contractBal, aaveYield.address
        );
        const depositPlusYield = totalTokens; // as there is only one order
        const yieldEarned = depositPlusYield.sub(EthersBN.from(inputAmount));

        // Execute Order
        await yolo.executeOrder(orderId, orderData, sushiswapHandler.address, 0x0);

        const daiBalAfterExecute = await daiContract.balanceOf(deployer.address);

        expect(Number(daiBalAfterExecute))
            .to.be.greaterThanOrEqual(
                Number(daiBalBeforeExecute) + Number(yieldEarned)
            );
    });

    it("Should transfer correct amount to recipient, executor & treasury", async () => {
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
        });

        const deployer = await ethers.provider.getSigner(
            "0xAb7677859331f95F25A3e7799176f7239feb5C44"
        );
        deployer.address = deployer._address;

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

        // Deploy Chainlink Oracle
        const ChainlinkOracle = await hre.ethers.getContractFactory("ChainlinkOracle");
        let chainlinkOracle = await ChainlinkOracle.deploy(deployer.address);

        await chainlinkOracle.deployed();

        chainlinkOracle = new ethers.Contract(
            chainlinkOracle.address,
            ChainlinkArtifacts.abi,
            deployer
        );
        await chainlinkOracle.updateTokenFeeds(
            [usdcAddress],
            ["0x986b5E1e1755e3C2440e960477f25201B0a8bbD4"], // USDC-ETH
        );
        await chainlinkOracle.updateTokenFeeds(
            [daiAddress],
            ["0x773616E4d11A78F511299002da57A0a94577F1f4"], // DAI-ETH
        );
        await chainlinkOracle.updatePriceSlippage(400);

        // Deploy Yolo Contract
        const Yolo = await ethers.getContractFactory("Yolo");

        let yolo = await upgrades.deployProxy(
            Yolo,
            [
                deployer.address,
                deployer.address,
                totalFeePercent,
                chainlinkOracle.address,
            ]
        );

        await yolo.deployed();

        yolo = new ethers.Contract(
            yolo.address,
            YoloArtifacts.abi,
            deployer
        );

        const Treasury = await ethers.getContractFactory("Treasury");
        const treasury = await upgrades.deployProxy(
            Treasury,
            [deployer.address]
        );
        await treasury.deployed();
        await yolo.updateTreasury(treasury.address);
        await yolo.updateProtocolFee(protocolFeePercent);

        // Deploy Sushiswap Handler
        const SushiswapHandler = await ethers.getContractFactory("SushiswapHandler");

        const sushiswapHandler = await SushiswapHandler.deploy(
            configParams.sushiswapRouter,
            configParams.wethAddress,
            configParams.wmaticAddress,
            configParams.sushiswapCodeHash,
            yolo.address
        );

        await sushiswapHandler.deployed();

        await yolo.addHandler(sushiswapHandler.address);
        await yolo.addWhitelistToken(daiAddress);

        await daiContract.approve(yolo.address, approveAmount);

        // Create Order
        const tx = await yolo.createOrder(
            recipient,
            daiAddress,
            usdcAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount,
            executor,
            executionFee,
        );

        const receipt = await tx.wait();
        const events = receipt.events.filter((x) => { return x.event == "OrderCreated" });

        const orderId = events[0].args[0];
        const orderData = events[0].args[1];

        // Advancing 100 blocks
        for (let i = 0; i < 100; ++i) {
            await time.advanceBlock();
        };

        const recipientBalBefore = await usdcContract.balanceOf(recipient);
        const executorBalBefore = await daiContract.balanceOf(executor);

        // Execute Order
        await yolo.executeOrder(orderId, orderData, sushiswapHandler.address, 0x0);

        const recipientBalAfter = await usdcContract.balanceOf(recipient);
        const executorBalAfter = await daiContract.balanceOf(executor);
        const treasuryBalAfter = await daiContract.balanceOf(treasury.address);

        const totalFee = getTotalFee(new BigNumber(inputAmount));
        const oracleResult = await chainlinkOracle.get(
            daiAddress,
            usdcAddress,
            (new BigNumber(inputAmount).minus(totalFee)).toString()
        );
        const oracleAmount = Number(oracleResult.amountOutWithSlippage);

        const amountOutMin = oracleAmount <= Number(stoplossAmount) ||
            oracleAmount > Number(minReturnAmount)
            ? oracleAmount
            : Number(minReturnAmount);

        const result = getParticipantsDividend(inputAmount);

        expect(Number(result.executorFee)).to.be
            .eq(Number(executorBalAfter.sub(executorBalBefore)));
        expect(Number(result.protocolFee)).to.be.eq(Number(treasuryBalAfter));
        expect(Number(recipientBalAfter.sub(recipientBalBefore))).to
            .be.greaterThanOrEqual(Number(amountOutMin));
    });

    it("Should revert if condition doesn't satisfy (sushiswap handler)", async () => {
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
        });

        const deployer = await ethers.provider.getSigner(
            "0xAb7677859331f95F25A3e7799176f7239feb5C44"
        );
        deployer.address = deployer._address;

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

        // Deploy Chainlink Oracle
        const ChainlinkOracle = await hre.ethers.getContractFactory("ChainlinkOracle");
        let chainlinkOracle = await ChainlinkOracle.deploy(deployer.address);

        await chainlinkOracle.deployed();

        chainlinkOracle = new ethers.Contract(
            chainlinkOracle.address,
            ChainlinkArtifacts.abi,
            deployer
        );
        await chainlinkOracle.updateTokenFeeds(
            [usdcAddress],
            ["0x986b5E1e1755e3C2440e960477f25201B0a8bbD4"], // USDC-ETH
        );
        await chainlinkOracle.updateTokenFeeds(
            [daiAddress],
            ["0x773616E4d11A78F511299002da57A0a94577F1f4"], // DAI-ETH
        );

        await chainlinkOracle.updatePriceSlippage(100);

        // Deploy Yolo Contract
        const Yolo = await ethers.getContractFactory("Yolo");

        let yolo = await upgrades.deployProxy(
            Yolo,
            [
                deployer.address,
                deployer.address,
                totalFeePercent,
                chainlinkOracle.address,
            ]
        );

        await yolo.deployed();

        yolo = new ethers.Contract(
            yolo.address,
            YoloArtifacts.abi,
            deployer
        );

        // Deploy Sushiswap Handler
        const SushiswapHandler = await ethers.getContractFactory("SushiswapHandler");

        const sushiswapHandler = await SushiswapHandler.deploy(
            configParams.sushiswapRouter,
            configParams.wethAddress,
            configParams.wmaticAddress,
            configParams.sushiswapCodeHash,
            yolo.address
        );

        await sushiswapHandler.deployed();

        await yolo.addHandler(sushiswapHandler.address);
        await yolo.addWhitelistToken(daiAddress);

        await daiContract.approve(yolo.address, approveAmount);

        const inputAmount1 = new BigNumber(inputAmount)
            .plus(new BigNumber(executionFee)).toString();
        const stoplossAmount1 = new BigNumber(9).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();

        // Create Order
        const tx = await yolo.createOrder(
            recipient,
            daiAddress,
            usdcAddress,
            inputAmount1,
            minReturnAmount,
            stoplossAmount1,
            executor,
            executionFee,
        );

        const receipt = await tx.wait();
        const events = receipt.events.filter((x) => { return x.event == "OrderCreated" });

        const orderId = events[0].args[0];
        const orderData = events[0].args[1];

        await expectRevert(
            yolo.executeOrder(orderId, orderData, sushiswapHandler.address, 0x0),
            'UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT'
        );
    });

    it("Should ececute order with allowed executor", async () => {
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
        });

        let deployer = await ethers.provider.getSigner(
            "0xAb7677859331f95F25A3e7799176f7239feb5C44"
        );
        deployer.address = deployer._address;

        // Create DAI contract instance
        const daiContract = new ethers.Contract(
            daiAddress,
            IERC20Artifacts.abi,
            deployer
        );

        // Deploy Chainlink Oracle
        const ChainlinkOracle = await hre.ethers.getContractFactory("ChainlinkOracle");
        let chainlinkOracle = await ChainlinkOracle.deploy(deployer.address);

        await chainlinkOracle.deployed();

        chainlinkOracle = new ethers.Contract(
            chainlinkOracle.address,
            ChainlinkArtifacts.abi,
            deployer
        );
        await chainlinkOracle.updateTokenFeeds(
            [usdcAddress],
            ["0x986b5E1e1755e3C2440e960477f25201B0a8bbD4"], // USDC-ETH
        );
        await chainlinkOracle.updateTokenFeeds(
            [daiAddress],
            ["0x773616E4d11A78F511299002da57A0a94577F1f4"], // DAI-ETH
        );

        await chainlinkOracle.updatePriceSlippage(100);

        // Deploy Yolo Contract
        const Yolo = await ethers.getContractFactory("Yolo");

        let yolo = await upgrades.deployProxy(
            Yolo,
            [
                deployer.address,
                deployer.address,
                totalFeePercent,
                chainlinkOracle.address,
            ]
        );

        await yolo.deployed();

        yolo = new ethers.Contract(
            yolo.address,
            YoloArtifacts.abi,
            deployer
        );

        // Deploy Sushiswap Handler
        const SushiswapHandler = await ethers
            .getContractFactory("SushiswapHandler");

        const sushiswapHandler = await SushiswapHandler.deploy(
            configParams.sushiswapRouter,
            configParams.wethAddress,
            configParams.wmaticAddress,
            configParams.sushiswapCodeHash,
            yolo.address
        );

        await sushiswapHandler.deployed();

        await yolo.addHandler(sushiswapHandler.address);
        await yolo.addWhitelistToken(daiAddress);

        await daiContract.approve(yolo.address, approveAmount);

        // Create Order
        const tx = await yolo.createOrder(
            recipient,
            daiAddress,
            usdcAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount,
            executor,
            executionFee,
        );

        const receipt = await tx.wait();
        const events = receipt.events.filter((x) => {
            return x.event == "OrderCreated"
        });

        const orderId = events[0].args[0];
        const orderData = events[0].args[1];

        const newExecutor = "0x606d09A4b4684b297308C358B4dC8Dc169776bBC";

        await yolo.approveExecutor(newExecutor);

        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [newExecutor]
        });
        deployer = await ethers.provider.getSigner(newExecutor);

        yolo = new ethers.Contract(
            yolo.address,
            YoloArtifacts.abi,
            deployer
        );

        const executeTx = await yolo.executeOrder(
            orderId,
            orderData,
            sushiswapHandler.address,
            0x0,
        );

        const executeRecipt = await executeTx.wait();
        const executeEvents = executeRecipt.events.filter((x) => {
            return x.event == "OrderExecuted"
        });

        const executeOrderId = executeEvents[0].args[0];
        expect(executeOrderId).to.eq(orderId);
    });

    it("Should revert if invalid executor or executor not allowed", async () => {
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
        });

        let deployer = await ethers.provider.getSigner(
            "0xAb7677859331f95F25A3e7799176f7239feb5C44"
        );
        deployer.address = deployer._address;

        // Create DAI contract instance
        const daiContract = new ethers.Contract(
            daiAddress,
            IERC20Artifacts.abi,
            deployer
        );

        // Deploy Yolo Contract
        const Yolo = await ethers.getContractFactory("Yolo");

        let yolo = await upgrades.deployProxy(
            Yolo,
            [
                deployer.address,
                deployer.address,
                totalFeePercent,
                ZERO_ADDRESS, // false chainlink oracle
            ]
        );

        await yolo.deployed();

        yolo = new ethers.Contract(
            yolo.address,
            YoloArtifacts.abi,
            deployer
        );

        // Deploy Sushiswap Handler
        const SushiswapHandler = await ethers
            .getContractFactory("SushiswapHandler");

        const sushiswapHandler = await SushiswapHandler.deploy(
            configParams.sushiswapRouter,
            configParams.wethAddress,
            configParams.wmaticAddress,
            configParams.sushiswapCodeHash,
            yolo.address
        );

        await sushiswapHandler.deployed();

        await yolo.addHandler(sushiswapHandler.address);
        await yolo.addWhitelistToken(daiAddress);

        await daiContract.approve(yolo.address, approveAmount);

        // Create Order
        const tx = await yolo.createOrder(
            recipient,
            daiAddress,
            usdcAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount,
            executor,
            executionFee,
        );

        const receipt = await tx.wait();
        const events = receipt.events.filter((x) => {
            return x.event == "OrderCreated"
        });

        const orderId = events[0].args[0];
        const orderData = events[0].args[1];

        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0x606d09A4b4684b297308C358B4dC8Dc169776bBC"]
        });
        deployer = await ethers.provider.getSigner(
            "0x606d09A4b4684b297308C358B4dC8Dc169776bBC"
        );

        yolo = new ethers.Contract(
            yolo.address,
            YoloArtifacts.abi,
            deployer
        );

        await expectRevert(
            yolo.executeOrder(orderId, orderData, sushiswapHandler.address, 0x0),
            'Yolo::executeOrder: order executor mismatch'
        );
    });
});

const getTotalFee = (amount) => {
    const _protocolFeePercent = new BigNumber(protocolFeePercent / 100);
    return new BigNumber(executionFee).plus(
        amount.multipliedBy(_protocolFeePercent).dividedBy(100)
    );
}

const getParticipantsDividend = (inputAmount) => {
    const _protocolFeePercent = new BigNumber(protocolFeePercent / 100);
    const executorFee = new BigNumber(executionFee);
    const protocolFee = new BigNumber(inputAmount)
        .times(_protocolFeePercent).dividedBy(100);
    return { executorFee, protocolFee };
}
