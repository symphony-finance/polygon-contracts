const { expect } = require("chai");
const { BigNumber: EthersBN } = require("ethers");
const { default: BigNumber } = require("bignumber.js");
const config = require("../config/index.json");
const { time } = require("@openzeppelin/test-helpers");
const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants");

const AaveYieldArtifacts = require(
    "../artifacts/contracts/adapters/AaveYield.sol/AaveYield.json"
);
const YoloArtifacts = require(
    "../artifacts/contracts/Yolo.sol/Yolo.json"
);
const IERC20Artifacts = require(
    "../artifacts/contracts/mocks/TestERC20.sol/TestERC20.json"
);

const daiAddress = "0x6b175474e89094c44da98b954eedeac495271d0f";
const usdcAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const aDaiAddress = "0x028171bCA77440897B824Ca71D1c56caC55b68A3";
const rewardToken = "0x4da27a545c0c5b758a6ba100e3a049001de870f5";

const recipient = "0xAb7677859331f95F25A3e7799176f7239feb5C44";
const executor = "0xAb7677859331f95F25A3e7799176f7239feb5C44";

const minReturnAmount = new BigNumber(15).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(6))
).toString();
const stoplossAmount = new BigNumber(8).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(6))
).toString();
const approveAmount = EthersBN.from(100000).mul(
    EthersBN.from(10).pow(EthersBN.from(18))
).toString();

describe("Aave Yield Test", () => {
    it("should claim reward and transfer to treasury", async () => {
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
                20, // 20 for 0.2%
                ZERO_ADDRESS
            ]
        );

        await yolo.deployed();

        yolo = new ethers.Contract(
            yolo.address,
            YoloArtifacts.abi,
            deployer
        );

        const Treasury = await ethers.getContractFactory("Treasury");
        let treasury = await upgrades.deployProxy(
            Treasury,
            [deployer.address]
        );
        await treasury.deployed();

        const AaveYield = await ethers.getContractFactory("AaveYield");

        const configParams = config.mainnet;
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

        const inputAmount1 = new BigNumber(10).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(18))
        );
        const executionFee = inputAmount1.multipliedBy(0.2).toString();

        // Create first order
        const tx1 = await yolo.createOrder(
            recipient,
            daiAddress,
            usdcAddress,
            inputAmount1.toString(),
            minReturnAmount,
            stoplossAmount,
            executor,
            executionFee
        );

        const tx1Receipt = await tx1.wait();
        const tx1Events = tx1Receipt.events
            .filter((x) => {
                return x.event == "OrderCreated"
            });
        const tx1Id = tx1Events[0].args[0];
        const tx1Data = tx1Events[0].args[1];

        const inputAmount2 = EthersBN.from(25000).mul(
            EthersBN.from(10).pow(EthersBN.from(18))
        ).toString();

        // Create second order
        const tx2 = await yolo.createOrder(
            recipient,
            daiAddress,
            usdcAddress,
            inputAmount2,
            minReturnAmount,
            stoplossAmount,
            executor,
            1 // executionFee
        );

        const tx2Receipt = await tx2.wait();
        const tx2Events = tx2Receipt.events
            .filter((x) => {
                return x.event == "OrderCreated"
            });
        const tx2Id = tx2Events[0].args[0];
        const tx2Data = tx2Events[0].args[1];

        // Advancing 100 blocks
        for (let i = 0; i < 100; ++i) {
            await time.advanceBlock();
        };

        // Cancel first order
        await yolo.cancelOrder(tx1Id, tx1Data);

        // Cancel second order
        await yolo.cancelOrder(tx2Id, tx2Data);

        const aAssets = [aDaiAddress];
        const rewardEarned = await aaveYield.getRewardBalance(aAssets);

        const rewardContract = new ethers.Contract(
            rewardToken,
            IERC20Artifacts.abi,
            deployer
        );

        expect(Number(await rewardContract.balanceOf(treasury.address)))
            .to.eq(0);

        await aaveYield.updateRoute([rewardToken, configParams.wethAddress, daiAddress]);
        await aaveYield.updateRouter(configParams.quickswapRouter);
        await aaveYield.updateBackupRouter(configParams.sushiswapRouter);

        await aaveYield.harvestReward();

        // TODO: check correct balance deposited in strategy
    });
});
