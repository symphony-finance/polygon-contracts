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
const MstableHandlerArtifacts = require(
    "../artifacts/contracts/handlers/MstableHandler.sol/MstableHandler.json"
);

const configParams = config.mainnet;
const daiAddress = "0x6b175474e89094c44da98b954eedeac495271d0f";
const usdcAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const musdAddress = "0xe2f2a5C287993345a840Db3B0845fbC70f5935a5";

const recipient = "0x1fd565b0f45e2f39518f64e2668f6dca4e313d71";
const executor = "0xAb7677859331f95F25A3e7799176f7239feb5C44";

const inputAmount = new BigNumber(10).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(6))
).toString();

const minReturnAmount = new BigNumber(10.2).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(18))
).toString();

const stoplossAmount = new BigNumber(9.99).times(
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
};

describe("Mstable Handler Test", () => {
    it("should swap token for Stable-Stable pair", async () => {
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

        // Deploy Mstable Handler
        const MstableHandler = await ethers.getContractFactory("MstableHandler");

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
            [usdcAddress, daiAddress],
            [
                "0x986b5E1e1755e3C2440e960477f25201B0a8bbD4", // USDC-ETH
                "0x773616E4d11A78F511299002da57A0a94577F1f4", // DAI-ETH
            ],
        );

        let mstableHandler = await MstableHandler.deploy(
            configParams.musdTokenAddress,
            deployer.address, // Fake Yolo Address
        );

        await mstableHandler.deployed();

        mstableHandler = new ethers.Contract(
            mstableHandler.address,
            MstableHandlerArtifacts.abi,
            deployer
        );

        await usdcContract.transfer(mstableHandler.address, order.inputAmount);

        const balanceBeforeSwap = await daiContract.balanceOf(recipient);

        const oracleResult = await chainlinkOracle.get(
            order.inputToken,
            order.outputToken,
            order.inputAmount
        );

        await mstableHandler.handle(
            order,
            oracleResult.amountOutWithSlippage,
            ZERO_BYTES32
        );

        const balanceAfterSwap = await daiContract.balanceOf(recipient);

        const oracleAmount = Number(oracleResult.amountOutWithSlippage);
        const amountOutMin = oracleAmount <= Number(order.stoplossAmount) ||
            oracleAmount > Number(order.minReturnAmount)
            ? oracleAmount
            : Number(order.minReturnAmount);

        expect(Number(balanceAfterSwap)).to.be.greaterThanOrEqual(
            Number(new BigNumber(amountOutMin).plus(
                new BigNumber(balanceBeforeSwap.toString()))
            )
        );
    });

    it("should swap token for mUSD-Stable pair", async () => {
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0x5C80E54f903458edD0723e268377f5768C7869d7"]
        });

        const deployer = await ethers.provider.getSigner(
            "0x5C80E54f903458edD0723e268377f5768C7869d7"
        );
        deployer.address = deployer._address;

        // Create mUSD contract instance
        const musdContract = new ethers.Contract(
            musdAddress,
            IERC20Artifacts.abi,
            deployer
        );

        // Create USDC contract instance
        const usdcContract = new ethers.Contract(
            usdcAddress,
            IERC20Artifacts.abi,
            deployer
        );

        // Deploy Mstable Handler
        const MstableHandler = await ethers.getContractFactory("MstableHandler");

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
            [musdAddress, usdcAddress],
            [
                "0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9", // DAI-USD
                "0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6", // USDC-USD
            ],
        );

        let mstableHandler = await MstableHandler.deploy(
            configParams.musdTokenAddress,
            deployer.address, // Fake Yolo Address
        );

        await mstableHandler.deployed();

        mstableHandler = new ethers.Contract(
            mstableHandler.address,
            MstableHandlerArtifacts.abi,
            deployer
        );

        const balanceBeforeSwap = await usdcContract.balanceOf(recipient);

        // Override Inputs
        order.inputToken = musdAddress;
        order.outputToken = usdcAddress;
        order.inputAmount = new BigNumber(10).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(18))
        ).toString();
        order.minReturnAmount = new BigNumber(9.9).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();
        order.stoplossAmount = "0";

        await musdContract.transfer(mstableHandler.address, order.inputAmount);

        const oracleResult = await chainlinkOracle.get(
            order.inputToken,
            order.outputToken,
            order.inputAmount
        );
        const oracleAmount = Number(oracleResult.amountOutWithSlippage);

        await mstableHandler.handle(
            order,
            oracleAmount.toString(),
            ZERO_BYTES32
        );

        const balanceAfterSwap = await usdcContract.balanceOf(recipient);

        const amountOutMin = oracleAmount <= Number(order.stoplossAmount) ||
            oracleAmount > Number(order.minReturnAmount)
            ? oracleAmount
            : Number(order.minReturnAmount);

        expect(Number(balanceAfterSwap)).to.be.greaterThanOrEqual(
            Number(new BigNumber(amountOutMin).plus(
                new BigNumber(balanceBeforeSwap.toString()))
            )
        );
    });
});
