const hre = require("hardhat");
const { expect } = require("chai");
const config = require("../config/index.json");
const { default: BigNumber } = require("bignumber.js");
const { time } = require("@openzeppelin/test-helpers");
const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants");

const IERC20Artifacts = require(
    "../artifacts/contracts/mocks/TestERC20.sol/TestERC20.json"
);
const YoloArtifacts = require(
    "../artifacts/contracts/Yolo.sol/Yolo.json"
);
const AaveYieldArtifacts = require(
    "../artifacts/contracts/adapters/AaveYield.sol/AaveYield.json"
);
const MstableYieldArtifacts = require(
    "../artifacts/contracts/adapters/MstableYield.sol/MstableYield.json"
);
const { AbiCoder } = require("ethers/lib/utils");

const daiAddress = "0x6b175474e89094c44da98b954eedeac495271d0f";
const usdcAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const executor = "0xAb7677859331f95F25A3e7799176f7239feb5C44";

const bufferPercent = 0; // 0%
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
    it("Should migrate existing strategy to new strategy and transfer tokens to new stratregy", async () => {
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

        // Deploy Yolo Contract
        const Yolo = await ethers.getContractFactory("Yolo");

        let yolo = await upgrades.deployProxy(
            Yolo,
            [
                deployer.address,
                deployer.address,
                40,
                ZERO_ADDRESS
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
        await yolo.addWhitelistToken(daiAddress);

        const approveAmount = new BigNumber(100)
            .times(
                new BigNumber(10)
                    .exponentiatedBy(new BigNumber(18))
            )
            .toString();

        await daiContract.approve(yolo.address, approveAmount);

        // Create Order
        await yolo.createOrder(
            deployer.address,
            daiAddress,
            usdcAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount,
            executor,
        );

        const strategyBal = Number(inputAmount) * (
            (10000 - bufferPercent) / 10000
        );

        expect(Number(await aaveYield.getTotalUnderlying(daiAddress)))
            .to.be.greaterThanOrEqual(strategyBal);

        for (let i = 0; i < 100; ++i) {
            await time.advanceBlock();
        };

        // Deploy MstableYield Contract
        const MstableYield = await hre.ethers.getContractFactory("MstableYield");

        let mstableYield = await MstableYield.deploy(
            configParams.musdTokenAddress,
            configParams.mstableSavingContract,
            yolo.address,
        );

        await mstableYield.deployed();

        mstableYield = new ethers.Contract(
            mstableYield.address,
            MstableYieldArtifacts.abi,
            deployer
        );

        await mstableYield.maxApprove(daiAddress);

        // Migrate Strategy to new contract
        await yolo.migrateStrategy(daiAddress, mstableYield.address);

        expect(await yolo.strategy(daiAddress)).to.eq(mstableYield.address);

        expect(Number(await aaveYield.getTotalUnderlying(daiAddress)))
            .to.eq(0);

        expect(Number(await mstableYield.callStatic.getTotalUnderlying(daiAddress)))
            .to.be.greaterThanOrEqual(
                Number(
                    new BigNumber(strategyBal) -
                    new BigNumber(strategyBal).times(0.2 / 100) // 0.2%
                )
            );
    });

    it("Should remove strategy of a token", async () => {
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

        // Deploy Yolo Contract
        const Yolo = await ethers.getContractFactory("Yolo");

        let yolo = await upgrades.deployProxy(
            Yolo,
            [
                deployer.address,
                deployer.address,
                40,
                ZERO_ADDRESS,
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
        await yolo.addWhitelistToken(daiAddress);

        await daiContract.approve(yolo.address, approveAmount);

        // Create Order
        await yolo.createOrder(
            deployer.address,
            daiAddress,
            usdcAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount,
            executor,
        );

        const yoloDaiBal = Number(
            await daiContract.balanceOf(yolo.address)
        );

        expect(yoloDaiBal).to.eq(
            Number(inputAmount) * (bufferPercent / 10000)
        );

        await yolo.migrateStrategy(daiAddress, ZERO_ADDRESS);

        expect(Number(await daiContract.balanceOf(yolo.address)))
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

        // Deploy Yolo Contract
        const Yolo = await ethers.getContractFactory("Yolo");

        let yolo = await upgrades.deployProxy(
            Yolo,
            [
                deployer.address,
                deployer.address,
                40,
                ZERO_ADDRESS,
            ]
        );

        await yolo.deployed();

        yolo = new ethers.Contract(
            yolo.address,
            YoloArtifacts.abi,
            deployer
        );

        await expect(
            yolo.migrateStrategy(usdcAddress, ZERO_ADDRESS)
        ).to.be.revertedWith(
            "Yolo::migrateStrategy: no previous strategy exists"
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

        // Deploy Yolo Contract
        const Yolo = await ethers.getContractFactory("Yolo");

        let yolo = await upgrades.deployProxy(
            Yolo,
            [
                deployer.address,
                deployer.address,
                40,
                ZERO_ADDRESS,
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

        const configParams = config.mainnet;
        let aaveYield = await AaveYield.deploy(
            yolo.address,
            deployer.address,
            usdcAddress,
            configParams.aaveLendingPool,
            configParams.aaveIncentivesController
        );

        await aaveYield.deployed();

        aaveYield = new ethers.Contract(
            aaveYield.address,
            AaveYieldArtifacts.abi,
            deployer
        );

        await yolo.setStrategy(usdcAddress, aaveYield.address);

        await expect(
            yolo.migrateStrategy(usdcAddress, aaveYield.address)
        ).to.be.revertedWith(
            "Yolo::migrateStrategy: new strategy same as previous"
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
