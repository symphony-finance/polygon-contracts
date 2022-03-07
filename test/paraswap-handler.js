const hre = require("hardhat");
const { default: BigNumber } = require("bignumber.js");
const { ParaSwap, SwapSide } = require('paraswap');

const IERC20Artifacts = require(
    "../artifacts/contracts/mocks/TestERC20.sol/TestERC20.json"
);
const ChainlinkArtifacts = require(
    "../artifacts/contracts/oracles/ChainlinkOracle.sol/ChainlinkOracle.json"
);
const ParaswapHandlerArtifacts = require(
    "../artifacts/contracts/handlers/ParaswapHandler.sol/ParaswapHandler.json"
);

const usdcAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const usdtAddress = "0xdac17f958d2ee523a2206206994597c13d831ec7";

const recipient = "0x1fd565b0f45e2f39518f64e2668f6dca4e313d71";
const executor = "0xAb7677859331f95F25A3e7799176f7239feb5C44";

const PARTNER = 'paraswap.io'
const networkID = 1;
const paraSwap = new ParaSwap(networkID);

const inputAmount = new BigNumber(1000).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(6))
).toString();

const minReturnAmount = new BigNumber(990).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(6))
).toString();

const stoplossAmount = new BigNumber(0).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(6))
).toString();

const order = {
    inputToken: usdcAddress,
    outputToken: usdtAddress,
    inputAmount,
    minReturnAmount,
    stoplossAmount,
    shares: 0,
    creator: recipient,
    recipient,
    executor,
    executionFee: 0,
};

describe("Paraswap Handler Test", () => {
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

        // Deploy Paraswap Handler
        const ParaswapHandler = await ethers.getContractFactory("ParaswapHandler");

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
            [usdtAddress],
            ["0xEe9F2375b4bdF6387aa8265dD4FB8F16512A1d46"], // USDT-ETH
        );

        await chainlinkOracle.updatePriceSlippage(500)

        let paraswapHandler = await ParaswapHandler.deploy(
            deployer.address // false yolo address
        );

        await paraswapHandler.deployed();

        paraswapHandler = new ethers.Contract(
            paraswapHandler.address,
            ParaswapHandlerArtifacts.abi,
            deployer
        );

        await usdcContract.transfer(paraswapHandler.address, order.inputAmount);

        const oracleResult = await chainlinkOracle.get(
            order.inputToken,
            order.outputToken,
            order.inputAmount
        );

        const swapDetails = await getSwapParams(order, paraswapHandler.address)
        data = swapDetails.transactionRequest.data

        await paraswapHandler.handle(
            order,
            oracleResult.amountOutWithSlippage,
            data
        );
    });
});

const getSwapParams = async (order, handlerAddress) => {
    const priceRoute = await paraSwap.getRate(
        order.inputToken,
        order.outputToken,
        order.inputAmount,
        handlerAddress,
        SwapSide.SELL,
        {
            maxImpact: 1,
            partner: PARTNER
        }
    );

    const minAmount = order.minReturnAmount;

    const transactionRequest = await paraSwap.buildTx(
        order.inputToken,
        order.outputToken,
        order.inputAmount,
        minAmount,
        priceRoute,
        handlerAddress,
        PARTNER,
        undefined,
        undefined,
        undefined,
        {
            ignoreChecks: true,
            ignoreGasEstimate: true,
        }
    );

    return { type: priceRoute.contractMethod, transactionRequest }
}
