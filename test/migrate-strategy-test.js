const hre = require("hardhat");
const { expect } = require("chai");
const config = require("../config/index.json");
const { default: BigNumber } = require("bignumber.js");
const { time } = require("@openzeppelin/test-helpers");
const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants");

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
const rewardToken = "0x4da27a545c0c5b758a6ba100e3a049001de870f5";
const bufferPercent = 4000; // 40%
const configParams = config.mainnet;

const inputAmount = new BigNumber(10).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(6))
).toString();

const minReturnAmount = new BigNumber(15).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(18))
).toString();

const stoplossAmount = new BigNumber(11).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(18))
).toString();

const approveAmount = new BigNumber(100)
    .times(
        new BigNumber(10)
            .exponentiatedBy(new BigNumber(18))
    )
    .toString();

describe("Migrate Strategy Test", () => {
    it("Should migrate existing strategy to new strategy", async () => {
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

        const aUsdcAddress = await aaveYield.getYieldTokenAddress(usdcAddress);

        // Create aUSDC contract instance
        const aUsdcInstance = new ethers.Contract(
            aUsdcAddress,
            IERC20Artifacts.abi,
            deployer
        );

        await symphony.updateStrategy(usdcAddress, aaveYield.address);
        await symphony.updateBufferPercentage(usdcAddress, 4000);

        const approveAmount = new BigNumber(100)
            .times(
                new BigNumber(10)
                    .exponentiatedBy(new BigNumber(18))
            )
            .toString();

        await usdcContract.approve(symphony.address, approveAmount);

        // Create Order
        await symphony.createOrder(
            deployer.address,
            usdcAddress,
            daiAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount
        );

        const requiredMinBufferBal = Number(inputAmount) * (
            (10000 - bufferPercent) / 10000
        );

        expect(Number(await aUsdcInstance.balanceOf(aaveYield.address)))
            .to.eq(requiredMinBufferBal);

        for (let i = 0; i < 100; ++i) {
            await time.advanceBlock();
        };

        const rewardBalance = await aaveYield.getRewardBalance(usdcAddress);

        expect(Number(rewardBalance)).to.be.greaterThan(0);

        // withdrawing reward from Aave
        await aaveYield.withdrawAaveReward(usdcAddress);

        // Create reward token contract instance
        const rewardContract = new ethers.Contract(
            rewardToken,
            IERC20Artifacts.abi,
            deployer
        );

        expect(
            Number(await rewardContract.balanceOf(aaveYield.address))
        ).greaterThanOrEqual(Number(rewardBalance));

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

        // Migrate Strategy to new contract
        await symphony.migrateStrategy(usdcAddress, aaveYieldNew.address);

        expect(await symphony.strategy(usdcAddress)).to.eq(aaveYieldNew.address);

        expect(await aUsdcInstance.balanceOf(aaveYield.address)).to.eq(0);
        expect(Number(await aUsdcInstance.balanceOf(aaveYieldNew.address)))
            .to.be.greaterThanOrEqual(requiredMinBufferBal);
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

        // Create USDC contract instance
        const usdcContract = new ethers.Contract(
            usdcAddress,
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
        await symphony.updateBufferPercentage(usdcAddress, bufferPercent);

        await usdcContract.approve(symphony.address, approveAmount);

        // Create Order
        await symphony.createOrder(
            deployer.address,
            usdcAddress,
            daiAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount
        );

        const symphonyUsdcBal = Number(
            await usdcContract.balanceOf(symphony.address)
        );

        expect(symphonyUsdcBal).to.eq(
            Number(inputAmount) * (bufferPercent / 10000)
        );

        await symphony.migrateStrategy(usdcAddress, ZERO_ADDRESS);

        expect(Number(await usdcContract.balanceOf(symphony.address)))
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
            symphony.migrateStrategy(usdcAddress, ZERO_ADDRESS)
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
            symphony.migrateStrategy(usdcAddress, aaveYield.address)
        ).to.be.revertedWith(
            "Symphony::migrateStrategy: new startegy shouldn't be same!!"
        );
    });
});
