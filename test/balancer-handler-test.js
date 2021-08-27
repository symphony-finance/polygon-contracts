const hre = require("hardhat");
const { expect } = require("chai");
const config = require("../config/index.json");
const { default: BigNumber } = require("bignumber.js");
const IERC20Artifacts = require(
    "../artifacts/contracts/mocks/TestERC20.sol/TestERC20.json"
);
const BalancerArtifacts = require(
    "../artifacts/contracts/handlers/BalancerHandler.sol/BalancerHandler.json"
);
const ChainlinkArtifacts = require(
    "../artifacts/contracts/oracles/ChainlinkOracle.sol/ChainlinkOracle.json"
);
const { AbiCoder } = require("ethers/lib/utils");
const { ZERO_ADDRESS, ZERO_BYTES32 } = require("@openzeppelin/test-helpers/src/constants");

const daiAddress = "0x6b175474e89094c44da98b954eedeac495271d0f";
const usdcAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const balAddress = "0xba100000625a3754423978a60c9317c58a424e3D";

const daiUsdcPool = "0x148ce9b50be946a96e94a4f5479b771bab9b1c59000100000000000000000054";
const usdcBalPool = "0x9c08c7a7a89cfd671c79eacdc6f07c1996277ed5000200000000000000000025";

const inputAmount = new BigNumber(1).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(6))
).toString();

describe("Balancer Handler Test", () => {
    it("Should swap with one hop", async () => {
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
        });

        const deployer = await ethers.provider.getSigner(
            "0xAb7677859331f95F25A3e7799176f7239feb5C44"
        );
        deployer.address = deployer._address;
        configParams = config.mainnet;

        // Create USDC contract instance
        const usdcContract = new ethers.Contract(
            usdcAddress,
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

        await chainlinkOracle.addTokenFeed(
            usdcAddress,
            "0x986b5E1e1755e3C2440e960477f25201B0a8bbD4", // USDC-ETH
        );

        await chainlinkOracle.addTokenFeed(
            balAddress,
            "0xC1438AA3823A6Ba0C159CfA8D98dF5A994bA120b", // BAL-ETH
        );

        // await chainlinkOracle.updatePriceSlippage(500);

        // Deploy Balancer Handler
        const BalancerHandler = await ethers.getContractFactory("MockBalancerHandler");

        let balancerHandler = await BalancerHandler.deploy(
            configParams.balancerVault,
            chainlinkOracle.address,
            ZERO_ADDRESS
        );

        await balancerHandler.deployed();

        balancerHandler = new ethers.Contract(
            balancerHandler.address,
            BalancerArtifacts.abi,
            deployer
        );

        const intermidiateAmount = "0";
        const data = encodeData(ZERO_ADDRESS, intermidiateAmount, usdcBalPool, ZERO_BYTES32);

        await usdcContract.transfer(balancerHandler.address, inputAmount);

        const minReturnAmount = new BigNumber(0.05).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(18))
        ).toString();

        const order = {
            recipient: deployer.address,
            inputToken: usdcAddress,
            outputToken: balAddress,
            inputAmount: inputAmount,
            minReturnAmount,
            stoplossAmount: 0,
            shares: 0,
        };

        // Create Bal contract instance
        const balContract = new ethers.Contract(
            balAddress,
            IERC20Artifacts.abi,
            deployer
        );

        const balBalanceBefore = await balContract.balanceOf(deployer.address);

        await balancerHandler.handle(
            order,
            40,
            2500,
            deployer.address, // false executor
            deployer.address, // false treasury
            data
        );

        const balBalanceAfter = await balContract.balanceOf(deployer.address);

        expect(Number(balBalanceAfter)).to.be
            .greaterThan(Number(balBalanceBefore.add(minReturnAmount)));
    });

    it("Should swap token with two hop", async () => {
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
        });

        const deployer = await ethers.provider.getSigner(
            "0xAb7677859331f95F25A3e7799176f7239feb5C44"
        );
        deployer.address = deployer._address;
        configParams = config.mainnet;

        // Create USDC contract instance
        const usdcContract = new ethers.Contract(
            usdcAddress,
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
        await chainlinkOracle.addTokenFeed(
            usdcAddress,
            "0x986b5E1e1755e3C2440e960477f25201B0a8bbD4", // USDC-ETH
        );

        await chainlinkOracle.addTokenFeed(
            daiAddress,
            "0x773616E4d11A78F511299002da57A0a94577F1f4", // DAI-ETH
        );

        await chainlinkOracle.updatePriceSlippage(450);

        // Deploy Balancer Handler
        const BalancerHandler = await ethers.getContractFactory("MockBalancerHandler");

        let balancerHandler = await BalancerHandler.deploy(
            configParams.balancerVault,
            chainlinkOracle.address,
            ZERO_ADDRESS
        );

        await balancerHandler.deployed();

        balancerHandler = new ethers.Contract(
            balancerHandler.address,
            BalancerArtifacts.abi,
            deployer
        );

        const intermidiateAmount = "0";
        const data = encodeData(balAddress, intermidiateAmount, usdcBalPool, daiUsdcPool);

        await usdcContract.transfer(balancerHandler.address, inputAmount);

        const minReturnAmount = new BigNumber(1.05).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(18))
        ).toString();

        const stoplossAmount = new BigNumber(0.98).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(18))
        ).toString();

        const order = {
            recipient: deployer.address,
            inputToken: usdcAddress,
            outputToken: daiAddress,
            inputAmount: inputAmount,
            minReturnAmount,
            stoplossAmount,
            shares: 0,
        };

        await balancerHandler.handle(
            order,
            40,
            2500,
            deployer.address,
            deployer.address,
            data
        );
    });
});

const encodeData = (intermidiate, intermidiateAmount, poolA, poolB) => {
    const abiCoder = new AbiCoder();

    return abiCoder.encode(
        ['address', 'uint256', 'bytes32', 'bytes32'],
        [intermidiate, intermidiateAmount, poolA, poolB]
    )
}
