const hre = require("hardhat");
const { expect } = require("chai");
const config = require("../config/index.json");
const { default: BigNumber } = require("bignumber.js");
const { ZERO_BYTES32 } = require("@openzeppelin/test-helpers/src/constants");

const IERC20Artifacts = require(
    "../artifacts/contracts/mocks/TestERC20.sol/TestERC20.json"
);
const ChainlinkArtifacts = require(
    "../artifacts/contracts/oracles/ChainlinkOracle.sol/ChainlinkOracle.json"
);
const SushiswapHandlerArtifacts = require(
    "../artifacts/contracts/mocks/MockSushiswapHandler.sol/MockSushiswapHandler.json"
);

const configParams = config.mainnet;
const totalFeePercent = 40; // 0.4%;
const protocolFeePercent = 2500; // 0.1%
const recipient = "0x1fd565b0f45e2f39518f64e2668f6dca4e313d71";
const daiAddress = "0x6b175474e89094c44da98b954eedeac495271d0f";
const usdcAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

const inputAmount = new BigNumber(10).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(6))
).toString();

const minReturnAmount = new BigNumber(10.2).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(18))
).toString();

const stoplossAmount = new BigNumber(9.98).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(18))
).toString();

const expectedReturn = new BigNumber(9.9).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(18))
).toString();

const order = {
    inputToken: usdcAddress,
    outputToken: daiAddress,
    inputAmount,
    minReturnAmount,
    stoplossAmount,
    shares: 0,
    recipient,
};

describe("Sushiswap Handler Test", () => {
    it("should swap asset", async () => {
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

        // Deploy Sushiswap Handler
        const SushiswapHandler = await ethers.getContractFactory(
            "MockSushiswapHandler"
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
        await chainlinkOracle.addTokenFeed(
            usdcAddress,
            "0x986b5E1e1755e3C2440e960477f25201B0a8bbD4", // USDC-ETH
        );

        await chainlinkOracle.addTokenFeed(
            daiAddress,
            "0x773616E4d11A78F511299002da57A0a94577F1f4", // DAI-ETH
        );

        let sushiswapHandler = await SushiswapHandler.deploy(
            configParams.sushiswapRouter, // Router
            configParams.wethAddress, // WETH
            configParams.wmaticAddress, // WMATIC
            configParams.sushiswapCodeHash,
            deployer.address // false symphony address
        );

        await sushiswapHandler.deployed();

        sushiswapHandler = new ethers.Contract(
            sushiswapHandler.address,
            SushiswapHandlerArtifacts.abi,
            deployer
        );

        await usdcContract.transfer(sushiswapHandler.address, inputAmount);

        const balanceBeforeSwap = await daiContract.balanceOf(recipient);

        const oracleAmount = await chainlinkOracle.get(
            order.inputToken,
            order.outputToken,
            order.inputAmount
        );

        await sushiswapHandler.handle(
            order,
            oracleAmount,
            40,
            2500,
            recipient,
            deployer.address, // false treasury
            ZERO_BYTES32
        );

        const balanceAfterSwap = await daiContract.balanceOf(recipient);
        const amountReceived = balanceAfterSwap.sub(balanceBeforeSwap);

        expect(Number(amountReceived)).to.be
            .greaterThanOrEqual(Number(expectedReturn));
    });

    it("should simulate the order execution correctly", async () => {
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
        });

        const deployer = await ethers.provider.getSigner(
            "0xAb7677859331f95F25A3e7799176f7239feb5C44"
        );
        deployer.address = deployer._address;

        // Deploy Chainlink Oracle
        const ChainlinkOracle = await hre.ethers.getContractFactory("ChainlinkOracle");
        let chainlinkOracle = await ChainlinkOracle.deploy(deployer.address);

        await chainlinkOracle.deployed();

        chainlinkOracle = new ethers.Contract(
            chainlinkOracle.address,
            ChainlinkArtifacts.abi,
            deployer
        );
        await chainlinkOracle.addTokenFeed(
            usdcAddress,
            "0x986b5E1e1755e3C2440e960477f25201B0a8bbD4", // USDC-ETH
        );

        await chainlinkOracle.addTokenFeed(
            daiAddress,
            "0x773616E4d11A78F511299002da57A0a94577F1f4", // DAI-ETH
        );

        // Deploy Sushiswap Handler
        const SushiswapHandler = await ethers.getContractFactory(
            "MockSushiswapHandler"
        );

        let sushiswapHandler = await SushiswapHandler.deploy(
            configParams.sushiswapRouter, // Router
            configParams.wethAddress, // WETH
            configParams.wmaticAddress, // WMATIC
            configParams.sushiswapCodeHash,
            deployer.address // false symphony address
        );

        await sushiswapHandler.deployed();

        sushiswapHandler = new ethers.Contract(
            sushiswapHandler.address,
            SushiswapHandlerArtifacts.abi,
            deployer
        );

        const oracleAmount = await chainlinkOracle.get(
            order.inputToken,
            order.outputToken,
            order.inputAmount
        );

        const result = await sushiswapHandler.simulate(
            order.inputToken,
            order.outputToken,
            order.inputAmount,
            order.minReturnAmount,
            stoplossAmount,
            oracleAmount,
            ZERO_BYTES32
        );

        expect(result.success).to.be.true;
        expect(Number(result.amountOut)).to.be.greaterThan(Number(expectedReturn));
    });

    it("should transfer correct amount to each participant", async () => {
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

        // Deploy Sushiswap Handler
        const SushiswapHandler = await ethers.getContractFactory(
            "MockSushiswapHandler"
        );

        let sushiswapHandler = await SushiswapHandler.deploy(
            configParams.sushiswapRouter, // Router
            configParams.wethAddress, // WETH
            configParams.wmaticAddress, // WMATIC
            configParams.sushiswapCodeHash,
            deployer.address // false symphony address
        );

        await sushiswapHandler.deployed();

        sushiswapHandler = new ethers.Contract(
            sushiswapHandler.address,
            SushiswapHandlerArtifacts.abi,
            deployer
        );

        const executor = "0x86A2EE8FAf9A840F7a2c64CA3d51209F9A02081D";
        const treasury = "0x49fd2BE640DB2910c2fAb69bB8531Ab6E76127ff";

        await daiContract.transfer(sushiswapHandler.address, minReturnAmount);

        const recipientBalBefore = await daiContract.balanceOf(recipient);
        const executorBalBefore = await daiContract.balanceOf(executor);
        const treasuryBalBefore = await daiContract.balanceOf(treasury);

        await sushiswapHandler._transferTokens(
            order.outputToken,
            minReturnAmount,
            recipient,
            executor,
            treasury,
            totalFeePercent,
            protocolFeePercent
        );

        const recipientBalAfter = await daiContract.balanceOf(recipient);
        const executorBalAfter = await daiContract.balanceOf(executor);
        const treasuryBalAfter = await daiContract.balanceOf(treasury);

        const result = getParticipantsDividend();

        expect(Number(result.recipientAmount)).to.be
            .eq(Number(recipientBalAfter.sub(recipientBalBefore)));
        expect(Number(result.executorFee)).to.be
            .eq(Number(executorBalAfter.sub(executorBalBefore)));
        expect(Number(result.protocolFee)).to.be
            .eq(Number(treasuryBalAfter.sub(treasuryBalBefore)));
    });

    // it("should return true if order can be handled", async () => {
    //     await network.provider.request({
    //         method: "hardhat_impersonateAccount",
    //         params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
    //     });

    //     const deployer = await ethers.provider.getSigner(
    //         "0xAb7677859331f95F25A3e7799176f7239feb5C44"
    //     );
    //     deployer.address = deployer._address;

    //     // Deploy Chainlink Oracle
    //     const ChainlinkOracle = await hre.ethers.getContractFactory("ChainlinkOracle");
    //     let chainlinkOracle = await ChainlinkOracle.deploy(deployer.address);

    //     await chainlinkOracle.deployed();

    //     chainlinkOracle = new ethers.Contract(
    //         chainlinkOracle.address,
    //         ChainlinkArtifacts.abi,
    //         deployer
    //     );
    //     await chainlinkOracle.addTokenFeed(
    //         usdcAddress,
    //         "0x986b5E1e1755e3C2440e960477f25201B0a8bbD4", // USDC-ETH
    //     );

    //     await chainlinkOracle.addTokenFeed(
    //         daiAddress,
    //         "0x773616E4d11A78F511299002da57A0a94577F1f4", // DAI-ETH
    //     );

    //     // Deploy Sushiswap Handler
    //     const SushiswapHandler = await ethers.getContractFactory(
    //         "MockSushiswapHandler"
    //     );

    //     let sushiswapHandler = await SushiswapHandler.deploy(
    //         configParams.sushiswapRouter, // Router
    //         configParams.wethAddress, // WETH
    //         configParams.wmaticAddress, // WMATIC
    //         configParams.sushiswapCodeHash,
    //         chainlinkOracle.address,
    //         deployer.address // false symphony address
    //     );

    //     await sushiswapHandler.deployed();

    //     sushiswapHandler = new ethers.Contract(
    //         sushiswapHandler.address,
    //         SushiswapHandlerArtifacts.abi,
    //         deployer
    //     );

    //     const result = await sushiswapHandler.canHandle(
    //         order.inputToken,
    //         order.outputToken,
    //         order.inputAmount,
    //         order.minReturnAmount,
    //         order.stoplossAmount,
    //         ZERO_BYTES32
    //     );

    //     expect(result).to.be.true;
    // });

    // it("should return false if order can't be handled", async () => {
    //     await network.provider.request({
    //         method: "hardhat_impersonateAccount",
    //         params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
    //     });

    //     const deployer = await ethers.provider.getSigner(
    //         "0xAb7677859331f95F25A3e7799176f7239feb5C44"
    //     );
    //     deployer.address = deployer._address;

    //     // Deploy Chainlink Oracle
    //     const ChainlinkOracle = await hre.ethers.getContractFactory("ChainlinkOracle");
    //     let chainlinkOracle = await ChainlinkOracle.deploy(deployer.address);

    //     await chainlinkOracle.deployed();

    //     chainlinkOracle = new ethers.Contract(
    //         chainlinkOracle.address,
    //         ChainlinkArtifacts.abi,
    //         deployer
    //     );
    //     await chainlinkOracle.addTokenFeed(
    //         usdcAddress,
    //         "0x986b5E1e1755e3C2440e960477f25201B0a8bbD4", // USDC-ETH
    //     );

    //     await chainlinkOracle.addTokenFeed(
    //         daiAddress,
    //         "0x773616E4d11A78F511299002da57A0a94577F1f4", // DAI-ETH
    //     );

    //     // Deploy Sushiswap Handler
    //     const SushiswapHandler = await ethers.getContractFactory(
    //         "MockSushiswapHandler"
    //     );

    //     let sushiswapHandler = await SushiswapHandler.deploy(
    //         configParams.sushiswapRouter, // Router
    //         configParams.wethAddress, // WETH
    //         configParams.wmaticAddress, // WMATIC
    //         configParams.sushiswapCodeHash,
    //         chainlinkOracle.address,
    //         deployer.address // false symphony address
    //     );

    //     await sushiswapHandler.deployed();

    //     sushiswapHandler = new ethers.Contract(
    //         sushiswapHandler.address,
    //         SushiswapHandlerArtifacts.abi,
    //         deployer
    //     );

    //     const newStoplossAmount = new BigNumber(9.9).times(
    //         new BigNumber(10).exponentiatedBy(new BigNumber(18))
    //     ).toString();

    //     const result = await sushiswapHandler.canHandle(
    //         order.inputToken,
    //         order.outputToken,
    //         order.inputAmount,
    //         order.minReturnAmount,
    //         newStoplossAmount,
    //         ZERO_BYTES32
    //     );

    //     expect(result).to.be.false;
    // });
});

const getParticipantsDividend = () => {
    const _totalFeePercent = new BigNumber(totalFeePercent / 100);

    const _protocolFeePercent = _totalFeePercent.times(protocolFeePercent / 10000);
    const _executorFeePercent = _totalFeePercent.minus(_protocolFeePercent);

    const recipientAmount = new BigNumber(minReturnAmount)
        .times(100 - _totalFeePercent).dividedBy(100);
    const executorFee = new BigNumber(minReturnAmount)
        .times(_executorFeePercent).dividedBy(100);
    const protocolFee = new BigNumber(minReturnAmount)
        .times(_protocolFeePercent).dividedBy(100);

    return { recipientAmount, executorFee, protocolFee };
}
