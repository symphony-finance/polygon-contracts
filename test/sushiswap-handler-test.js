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
    "../artifacts/contracts/handlers/SushiswapHandler.sol/SushiswapHandler.json"
);

const configParams = config.mainnet;
const daiAddress = "0x6b175474e89094c44da98b954eedeac495271d0f";
const usdcAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

const recipient = "0x1fd565b0f45e2f39518f64e2668f6dca4e313d71";
const executor = "0xAb7677859331f95F25A3e7799176f7239feb5C44";

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
    creator: recipient,
    recipient,
    executor,
    executionFee: 0,
};

describe("Sushiswap Handler Test", () => {
    it("should swap token", async () => {
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
            "SushiswapHandler"
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

        let sushiswapHandler = await SushiswapHandler.deploy(
            configParams.sushiswapRouter,
            configParams.wethAddress,
            configParams.wmaticAddress,
            configParams.sushiswapCodeHash,
            deployer.address // false yolo address
        );

        await sushiswapHandler.deployed();

        sushiswapHandler = new ethers.Contract(
            sushiswapHandler.address,
            SushiswapHandlerArtifacts.abi,
            deployer
        );

        await usdcContract.transfer(sushiswapHandler.address, order.inputAmount);

        const balanceBeforeSwap = await daiContract.balanceOf(recipient);

        const oracleResult = await chainlinkOracle.get(
            order.inputToken,
            order.outputToken,
            order.inputAmount
        );

        await sushiswapHandler.handle(
            order,
            oracleResult.amountOutWithSlippage,
            ZERO_BYTES32
        );

        const balanceAfterSwap = await daiContract.balanceOf(recipient);
        const amountReceived = balanceAfterSwap.sub(balanceBeforeSwap);

        expect(Number(amountReceived)).to.be
            .greaterThanOrEqual(Number(expectedReturn));
    });

    it("should swap token with hops", async () => {
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

        const balAddress = "0xba100000625a3754423978a60c9317c58a424e3d";

        // Create BAL contract instance
        const balContract = new ethers.Contract(
            balAddress,
            IERC20Artifacts.abi,
            deployer
        );

        // Deploy Sushiswap Handler
        const SushiswapHandler = await ethers.getContractFactory(
            "SushiswapHandler"
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
            [balAddress],
            ["0xC1438AA3823A6Ba0C159CfA8D98dF5A994bA120b"], // BAL-ETH
        );

        await chainlinkOracle.updatePriceSlippage(300); // 3%

        let sushiswapHandler = await SushiswapHandler.deploy(
            configParams.sushiswapRouter,
            configParams.wethAddress,
            configParams.wmaticAddress,
            configParams.sushiswapCodeHash,
            deployer.address // false yolo address
        );

        await sushiswapHandler.deployed();

        sushiswapHandler = new ethers.Contract(
            sushiswapHandler.address,
            SushiswapHandlerArtifacts.abi,
            deployer
        );

        const balanceBeforeSwap = await balContract.balanceOf(recipient);

        const newOrder = {
            inputToken: usdcAddress,
            outputToken: balAddress,
            inputAmount,
            minReturnAmount: '0',
            stoplossAmount: '0',
            shares: 0,
            creator: recipient,
            recipient,
            executor,
            executionFee: 0,
        };

        newOrder.minReturnAmount = new BigNumber(0.5).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(18))
        ).toString();

        await usdcContract.transfer(sushiswapHandler.address, newOrder.inputAmount);

        const oracleResult = await chainlinkOracle.get(
            newOrder.inputToken,
            newOrder.outputToken,
            newOrder.inputAmount
        );

        await sushiswapHandler.handle(
            newOrder,
            oracleResult.amountOutWithSlippage,
            ZERO_BYTES32
        );

        const balanceAfterSwap = await balContract.balanceOf(recipient);
        const amountReceived = balanceAfterSwap.sub(balanceBeforeSwap);

        expect(Number(amountReceived)).to.be
            .greaterThanOrEqual(Number(newOrder.minReturnAmount));
    });
});
