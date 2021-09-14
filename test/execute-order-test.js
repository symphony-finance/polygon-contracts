const hre = require("hardhat");
const { expect } = require("chai");
const config = require("../config/index.json");
const { AbiCoder } = require("ethers/lib/utils");
const { BigNumber: EthersBN } = require("ethers");
const { default: BigNumber } = require("bignumber.js");
const { time, expectRevert } = require("@openzeppelin/test-helpers");
const IERC20Artifacts = require(
    "../artifacts/contracts/mocks/TestERC20.sol/TestERC20.json"
);
const SymphonyArtifacts = require(
    "../artifacts/contracts/Symphony.sol/Symphony.json"
);
const AaveYieldArtifacts = require(
    "../artifacts/contracts/adapters/AaveYield.sol/AaveYield.json"
);
const ChainlinkArtifacts = require(
    "../artifacts/contracts/oracles/ChainlinkOracle.sol/ChainlinkOracle.json"
);
const {
    ZERO_ADDRESS, ZERO_BYTES32
} = require("@openzeppelin/test-helpers/src/constants");

const configParams = config.mainnet;
const daiAddress = "0x6b175474e89094c44da98b954eedeac495271d0f";
const usdcAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const balAddress = "0xba100000625a3754423978a60c9317c58a424e3D";

const daiBalPool = "0x148ce9b50be946a96e94a4f5479b771bab9b1c59000100000000000000000054";
const usdcBalPool = "0x9c08c7a7a89cfd671c79eacdc6f07c1996277ed5000200000000000000000025";

const inputAmount = new BigNumber(10).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(18))
).toString();

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

const expectedReturn = new BigNumber(9.9).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(6))
).toString();

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
        await chainlinkOracle.updateTokenFeed(
            usdcAddress,
            "0x986b5E1e1755e3C2440e960477f25201B0a8bbD4", // USDC-ETH
        );

        await chainlinkOracle.updateTokenFeed(
            daiAddress,
            "0x773616E4d11A78F511299002da57A0a94577F1f4", // DAI-ETH
        );

        await chainlinkOracle.updatePriceSlippage(100);

        // Deploy Symphony Contract
        const Symphony = await ethers.getContractFactory("Symphony");

        let symphony = await upgrades.deployProxy(
            Symphony,
            [
                deployer.address,
                deployer.address,
                40,
                chainlinkOracle.address,
            ]
        );

        await symphony.deployed();

        symphony = new ethers.Contract(
            symphony.address,
            SymphonyArtifacts.abi,
            deployer
        );

        // Deploy AaveYield Contract
        const AaveYield = await hre.ethers.getContractFactory("AaveYield");

        let aaveYield = await upgrades.deployProxy(
            AaveYield,
            [
                symphony.address,
                deployer.address,
                configParams.aaveLendingPool,
                configParams.aaveProtocolDataProvider,
                configParams.aaveIncentivesController
            ]
        );

        await aaveYield.deployed();

        aaveYield = new ethers.Contract(
            aaveYield.address,
            AaveYieldArtifacts.abi,
            deployer
        );

        await symphony.updateStrategy(daiAddress, aaveYield.address);
        await symphony.updateBufferPercentage(daiAddress, 4000);

        // Deploy Sushiswap Handler
        const SushiswapHandler = await ethers.getContractFactory("SushiswapHandler");

        const sushiswapHandler = await SushiswapHandler.deploy(
            configParams.sushiswapRouter, // Router
            configParams.wethAddress, // WETH
            configParams.wmaticAddress, // WMATIC
            configParams.sushiswapCodeHash,
            symphony.address
        );

        await sushiswapHandler.deployed();

        // Add Handler
        await symphony.addHandler(sushiswapHandler.address);

        await daiContract.approve(symphony.address, approveAmount);
        await usdcContract.approve(symphony.address, approveAmount);

        await symphony.addWhitelistAsset(daiAddress);

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

        const daiBalBeforeExecute = await daiContract.balanceOf(deployer.address);
        const usdcBalBeforeExecute = await usdcContract.balanceOf(deployer.address);

        // Advancing 100 blocks
        for (let i = 0; i < 100; ++i) {
            await time.advanceBlock();
        };

        const oracleResult = await chainlinkOracle.get(
            daiAddress,
            usdcAddress,
            inputAmount
        );
        const oracleAmount = Number(oracleResult.amountOutWithSlippage);

        const amountOutMin = oracleAmount <= Number(stoplossAmount) ||
            oracleAmount > Number(minReturnAmount)
            ? oracleAmount
            : Number(minReturnAmount);

        const totalTokens = await symphony.getTotalFunds(daiAddress);
        const depositPlusYield = totalTokens; // as there is only one order
        const yieldEarned = depositPlusYield.sub(EthersBN.from(inputAmount));

        // Execute Order
        await symphony.executeOrder(orderId, orderData, sushiswapHandler.address, 0x0);

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

    it("Should execute order with Balancer Handler & Aave Yield", async () => {
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
        await chainlinkOracle.updateTokenFeed(
            usdcAddress,
            "0x986b5E1e1755e3C2440e960477f25201B0a8bbD4", // USDC-ETH
        );

        await chainlinkOracle.updateTokenFeed(
            daiAddress,
            "0x773616E4d11A78F511299002da57A0a94577F1f4", // DAI-ETH
        );

        await chainlinkOracle.updatePriceSlippage(80);

        // Deploy Symphony Contract
        const Symphony = await ethers.getContractFactory("Symphony");

        let symphony = await upgrades.deployProxy(
            Symphony,
            [
                deployer.address,
                deployer.address,
                40,
                chainlinkOracle.address,
            ]
        );

        await symphony.deployed();

        symphony = new ethers.Contract(
            symphony.address,
            SymphonyArtifacts.abi,
            deployer
        );

        // Deploy AaveYield Contract
        const AaveYield = await hre.ethers.getContractFactory("AaveYield");

        let aaveYield = await upgrades.deployProxy(
            AaveYield,
            [
                symphony.address,
                deployer.address,
                configParams.aaveLendingPool,
                configParams.aaveProtocolDataProvider,
                configParams.aaveIncentivesController
            ]
        );

        await aaveYield.deployed();

        aaveYield = new ethers.Contract(
            aaveYield.address,
            AaveYieldArtifacts.abi,
            deployer
        );

        await symphony.updateStrategy(daiAddress, aaveYield.address);
        await symphony.updateBufferPercentage(daiAddress, 4000);

        // Deploy Sushiswap Handler
        const BalancerHandler = await ethers.getContractFactory("BalancerHandler");

        const balancerHandler = await BalancerHandler.deploy(
            configParams.balancerVault,
            symphony.address
        );

        await balancerHandler.deployed();

        // Add Handler
        await symphony.addHandler(balancerHandler.address);

        await daiContract.approve(symphony.address, approveAmount);
        await usdcContract.approve(symphony.address, approveAmount);

        await symphony.addWhitelistAsset(daiAddress);

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

        // Advancing 100 blocks
        for (let i = 0; i < 100; ++i) {
            await time.advanceBlock();
        };

        const addresses = [daiAddress, balAddress, usdcAddress];
        const swapSteps = [{
            poolId: daiBalPool,
            assetInIndex: '0',
            assetOutIndex: '1',
            amount: inputAmount,
            userData: 0x0,
        }, {
            poolId: usdcBalPool,
            assetInIndex: '1',
            assetOutIndex: '2',
            amount: 0,
            userData: 0x0,
        }];
        const data = encodeBalHandlerData(addresses, swapSteps);

        // Execute Order
        await symphony.executeOrder(orderId, orderData, balancerHandler.address, data)

        const usdcBalAfterExecute = await usdcContract.balanceOf(deployer.address);

        expect(Number(usdcBalAfterExecute)).to.be.greaterThanOrEqual(
            Number(usdcBalBeforeExecute) + Number(expectedReturn)
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
        await chainlinkOracle.updateTokenFeed(
            usdcAddress,
            "0x986b5E1e1755e3C2440e960477f25201B0a8bbD4", // USDC-ETH
        );

        await chainlinkOracle.updateTokenFeed(
            daiAddress,
            "0x773616E4d11A78F511299002da57A0a94577F1f4", // DAI-ETH
        );

        await chainlinkOracle.updatePriceSlippage(100);

        // Deploy Symphony Contract
        const Symphony = await ethers.getContractFactory("Symphony");

        let symphony = await upgrades.deployProxy(
            Symphony,
            [
                deployer.address,
                deployer.address,
                40,
                chainlinkOracle.address,
            ]
        );

        await symphony.deployed();
        symphony = new ethers.Contract(
            symphony.address,
            SymphonyArtifacts.abi,
            deployer
        );

        // Deploy AaveYield Contract
        const AaveYield = await hre.ethers.getContractFactory("AaveYield");

        let aaveYield = await upgrades.deployProxy(
            AaveYield,
            [
                symphony.address,
                deployer.address,
                configParams.aaveLendingPool,
                configParams.aaveProtocolDataProvider,
                configParams.aaveIncentivesController
            ]
        );

        await aaveYield.deployed();
        aaveYield = new ethers.Contract(
            aaveYield.address,
            AaveYieldArtifacts.abi,
            deployer
        );

        await symphony.updateStrategy(daiAddress, aaveYield.address);
        await symphony.updateBufferPercentage(daiAddress, 4000);

        // Deploy Sushiswap Handler
        const SushiswapHandler = await ethers.getContractFactory("SushiswapHandler");

        const sushiswapHandler = await SushiswapHandler.deploy(
            configParams.sushiswapRouter, // Router
            configParams.wethAddress, // WETH
            configParams.wmaticAddress, // WMATIC
            configParams.sushiswapCodeHash,
            symphony.address
        );

        await sushiswapHandler.deployed();

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

        await symphony.addWhitelistAsset(daiAddress);

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

        const data = encodeData(
            ZERO_ADDRESS,
            0,
            ZERO_BYTES32,
            []
        );

        // Remove yield strategy
        await symphony.migrateStrategy(daiAddress, ZERO_ADDRESS, data);

        const usdcBalBeforeExecute = await usdcContract.balanceOf(deployer.address);

        // Execute Order
        await symphony.executeOrder(orderId, orderData, sushiswapHandler.address, 0x0);

        const usdcBalAfterExecute = await usdcContract.balanceOf(deployer.address);

        expect(Number(usdcBalAfterExecute)).to.be.greaterThanOrEqual(
            Number(usdcBalBeforeExecute) + Number(expectedReturn)
        );
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
        await chainlinkOracle.updateTokenFeed(
            usdcAddress,
            "0x986b5E1e1755e3C2440e960477f25201B0a8bbD4", // USDC-ETH
        );

        await chainlinkOracle.updateTokenFeed(
            daiAddress,
            "0x773616E4d11A78F511299002da57A0a94577F1f4", // DAI-ETH
        );

        await chainlinkOracle.updatePriceSlippage(100);

        // Deploy Symphony Contract
        const Symphony = await ethers.getContractFactory("Symphony");

        let symphony = await upgrades.deployProxy(
            Symphony,
            [
                deployer.address,
                deployer.address,
                40,
                chainlinkOracle.address,
            ]
        );

        await symphony.deployed();

        symphony = new ethers.Contract(
            symphony.address,
            SymphonyArtifacts.abi,
            deployer
        );

        // Deploy Sushiswap Handler
        const SushiswapHandler = await ethers.getContractFactory("SushiswapHandler");

        const sushiswapHandler = await SushiswapHandler.deploy(
            configParams.sushiswapRouter, // Router
            configParams.wethAddress, // WETH
            configParams.wmaticAddress, // WMATIC
            configParams.sushiswapCodeHash,
            symphony.address
        );

        await sushiswapHandler.deployed();

        // Add Handler
        await symphony.addHandler(sushiswapHandler.address);

        await daiContract.approve(symphony.address, approveAmount);
        await usdcContract.approve(symphony.address, approveAmount);

        await symphony.addWhitelistAsset(daiAddress);

        const stoplossAmount1 = new BigNumber(9).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();

        // Create Order
        const tx = await symphony.createOrder(
            deployer.address,
            daiAddress,
            usdcAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount1
        );

        const receipt = await tx.wait();
        const events = receipt.events.filter((x) => { return x.event == "OrderCreated" });

        const orderId = events[0].args[0];
        const orderData = events[0].args[1];

        await expectRevert(
            symphony.executeOrder(orderId, orderData, sushiswapHandler.address, 0x0),
            'UniswapV2Router: INSUFFICIENT_OUTPUT_AMOUNT'
        );
    });

    it("Should revert if condition doesn't satisfy (balancer handler)", async () => {
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
        await chainlinkOracle.updateTokenFeed(
            usdcAddress,
            "0x986b5E1e1755e3C2440e960477f25201B0a8bbD4", // USDC-ETH
        );

        await chainlinkOracle.updateTokenFeed(
            daiAddress,
            "0x773616E4d11A78F511299002da57A0a94577F1f4", // DAI-ETH
        );

        await chainlinkOracle.updatePriceSlippage(100);

        // Deploy Symphony Contract
        const Symphony = await ethers.getContractFactory("Symphony");

        let symphony = await upgrades.deployProxy(
            Symphony,
            [
                deployer.address,
                deployer.address,
                40,
                chainlinkOracle.address,
            ]
        );

        await symphony.deployed();

        symphony = new ethers.Contract(
            symphony.address,
            SymphonyArtifacts.abi,
            deployer
        );

        // Deploy Balancer Handler
        const BalancerHandler = await ethers.getContractFactory("BalancerHandler");

        const balancerHandler = await BalancerHandler.deploy(
            configParams.balancerVault,
            symphony.address
        );

        await balancerHandler.deployed();

        // Add Handler
        await symphony.addHandler(balancerHandler.address);

        await daiContract.approve(symphony.address, approveAmount);
        await usdcContract.approve(symphony.address, approveAmount);

        await symphony.addWhitelistAsset(daiAddress);

        const stoplossAmount1 = new BigNumber(9).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();

        // Create Order
        const tx = await symphony.createOrder(
            deployer.address,
            daiAddress,
            usdcAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount1
        );

        const receipt = await tx.wait();
        const events = receipt.events.filter((x) => { return x.event == "OrderCreated" });

        const orderId = events[0].args[0];
        const orderData = events[0].args[1];

        const addresses = [daiAddress, balAddress, usdcAddress];
        const swapSteps = [{
            poolId: daiBalPool,
            assetInIndex: '0',
            assetOutIndex: '1',
            amount: inputAmount,
            userData: 0x0,
        }, {
            poolId: usdcBalPool,
            assetInIndex: '1',
            assetOutIndex: '2',
            amount: 0,
            userData: 0x0,
        }];
        const data = encodeBalHandlerData(addresses, swapSteps);

        await expectRevert(
            symphony.executeOrder(orderId, orderData, balancerHandler.address, data),
            'BalancerHandler: Amount mismatch !!'
        );
    });
});

const encodeData = (router, slippage, codeHash, path) => {
    const abiCoder = new AbiCoder();

    return abiCoder.encode(
        ['address', 'uint256', 'bytes32', 'address[]'],
        [router, slippage, codeHash, path]
    )
}

const encodeBalHandlerData = (addresses, swapSteps) => {
    const abiCoder = new AbiCoder();

    return abiCoder.encode(
        [
            'address[]',
            "tuple(bytes32 poolId, uint256 assetInIndex, uint256 assetOutIndex, uint256 amount, bytes userData)[]"
        ],
        [addresses, swapSteps]
    )
}