const hre = require("hardhat");
const { expect } = require("chai");
const config = require("../config/index.json");
const { default: BigNumber } = require("bignumber.js");
const { time } = require("@openzeppelin/test-helpers");
const { ZERO_ADDRESS, ZERO_BYTES32 } = require("@openzeppelin/test-helpers/src/constants");

const IERC20Artifacts = require(
    "../artifacts/contracts/mocks/TestERC20.sol/TestERC20.json"
);
const SymphonyArtifacts = require(
    "../artifacts/contracts/Symphony.sol/Symphony.json"
);
const AaveYieldArtifacts = require(
    "../artifacts/contracts/adapters/AaveYield.sol/AaveYield.json"
);
const { AbiCoder } = require("ethers/lib/utils");

const daiAddress = "0x6b175474e89094c44da98b954eedeac495271d0f";
const usdcAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const rewardToken = "0x4da27a545c0c5b758a6ba100e3a049001de870f5";
const bufferPercent = 4000; // 40%
const configParams = config.mainnet;

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

describe("Migrate Strategy Test", () => {
    it("Should migrate existing strategy to new strategy and transfer assets to new stratregy", async () => {
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

        // Deploy Symphony Contract
        const Symphony = await ethers.getContractFactory("Symphony");

        let symphony = await upgrades.deployProxy(
            Symphony,
            [
                deployer.address,
                deployer.address,
                40,
                ZERO_ADDRESS
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

        const aDaiAddress = await aaveYield.getYieldTokenAddress(daiAddress);

        // Create aUSDC contract instance
        const aDaiContract = new ethers.Contract(
            aDaiAddress,
            IERC20Artifacts.abi,
            deployer
        );

        await symphony.updateStrategy(daiAddress, aaveYield.address);
        await symphony.updateBufferPercentage(daiAddress, 4000);

        const approveAmount = new BigNumber(100)
            .times(
                new BigNumber(10)
                    .exponentiatedBy(new BigNumber(18))
            )
            .toString();

        await daiContract.approve(symphony.address, approveAmount);

        await symphony.addWhitelistAsset(daiAddress);

        // Create Order
        await symphony.createOrder(
            deployer.address,
            daiAddress,
            usdcAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount
        );

        const strategyBal = Number(inputAmount) * (
            (10000 - bufferPercent) / 10000
        );

        expect(Number(await aDaiContract.balanceOf(aaveYield.address)))
            .to.greaterThanOrEqual(Number(strategyBal));

        for (let i = 0; i < 100; ++i) {
            await time.advanceBlock();
        };

        // Deploy AaveYield Contract
        const AaveYieldNew = await hre.ethers.getContractFactory("AaveYield");

        let aaveYieldNew = await upgrades.deployProxy(
            AaveYieldNew,
            [
                symphony.address,
                deployer.address,
                configParams.aaveLendingPool,
                configParams.aaveProtocolDataProvider,
                configParams.aaveIncentivesController
            ]
        );

        await aaveYieldNew.deployed();

        const rewardBalance = await aaveYield.getRewardBalance();

        expect(Number(rewardBalance)).to.be.greaterThan(0);

        // construct extra data for swapping reward
        const extraData = encodeData(
            "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D", // Uniswap V2 Router
            100,
            "0x96e8ac4277198ff8b6f785478aa9a39f403cb768dd02cbee326c3e7da348845f", // Uniswap V2 init code hash
            [rewardToken, configParams.wethAddress, daiAddress]
        );

        // Migrate Strategy to new contract
        await symphony.migrateStrategy(daiAddress, aaveYieldNew.address, extraData);

        // expect(
        //     Number(await rewardContract.balanceOf(symphony.address))
        // ).greaterThanOrEqual(Number(rewardBalance.add(symphonyRewardBal)));

        expect(await symphony.strategy(daiAddress)).to.eq(aaveYieldNew.address);

        expect(await aDaiContract.balanceOf(aaveYield.address)).to.eq(0);
        expect(Number(await aDaiContract.balanceOf(aaveYieldNew.address)))
            .to.be.greaterThanOrEqual(strategyBal);
    });

    it("Should remove strategy of an asset", async () => {
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

        // Deploy Symphony Contract
        const Symphony = await ethers.getContractFactory("Symphony");

        let symphony = await upgrades.deployProxy(
            Symphony,
            [
                deployer.address,
                deployer.address,
                40,
                ZERO_ADDRESS,
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
        await symphony.updateBufferPercentage(daiAddress, bufferPercent);

        await daiContract.approve(symphony.address, approveAmount);

        await symphony.addWhitelistAsset(daiAddress);

        // Create Order
        await symphony.createOrder(
            deployer.address,
            daiAddress,
            usdcAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount
        );

        const symphonyDaiBal = Number(
            await daiContract.balanceOf(symphony.address)
        );

        expect(symphonyDaiBal).to.eq(
            Number(inputAmount) * (bufferPercent / 10000)
        );

        const data = encodeData(
            ZERO_ADDRESS,
            0,
            ZERO_BYTES32,
            []
        );

        await symphony.migrateStrategy(daiAddress, ZERO_ADDRESS, data);

        expect(Number(await daiContract.balanceOf(symphony.address)))
            .to.be.greaterThanOrEqual(Number(inputAmount) - 1);
    });

    it("Should revert if no existing strategy", async () => {
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
        });

        const deployer = await ethers.provider.getSigner(
            "0xAb7677859331f95F25A3e7799176f7239feb5C44"
        );
        deployer.address = deployer._address;

        // Deploy Symphony Contract
        const Symphony = await ethers.getContractFactory("Symphony");

        let symphony = await upgrades.deployProxy(
            Symphony,
            [
                deployer.address,
                deployer.address,
                40,
                ZERO_ADDRESS,
            ]
        );

        await symphony.deployed();

        symphony = new ethers.Contract(
            symphony.address,
            SymphonyArtifacts.abi,
            deployer
        );

        await expect(
            symphony.migrateStrategy(usdcAddress, ZERO_ADDRESS, ZERO_BYTES32)
        ).to.be.revertedWith(
            "Symphony::migrateStrategy: no strategy for asset exists!!"
        );
    });

    it("Should revert if migrating to same strategy", async () => {
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
        });

        const deployer = await ethers.provider.getSigner(
            "0xAb7677859331f95F25A3e7799176f7239feb5C44"
        );
        deployer.address = deployer._address;

        // Deploy Symphony Contract
        const Symphony = await ethers.getContractFactory("Symphony");

        let symphony = await upgrades.deployProxy(
            Symphony,
            [
                deployer.address,
                deployer.address,
                40,
                ZERO_ADDRESS,
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

        const configParams = config.mainnet;
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

        await symphony.updateStrategy(usdcAddress, aaveYield.address);

        await expect(
            symphony.migrateStrategy(usdcAddress, aaveYield.address, ZERO_BYTES32)
        ).to.be.revertedWith(
            "Symphony::migrateStrategy: new startegy shouldn't be same!!"
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
