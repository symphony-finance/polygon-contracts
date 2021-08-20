const { expect } = require("chai");
const { default: BigNumber } = require("bignumber.js");
const config = require("../config/index.json");
const { time } = require("@openzeppelin/test-helpers");
const IERC20Artifacts = require(
    "../artifacts/contracts/mocks/TestERC20.sol/TestERC20.json"
);
const SymphonyArtifacts = require(
    "../artifacts/contracts/Symphony.sol/Symphony.json"
);

const daiAddress = "0x6b175474e89094c44da98b954eedeac495271d0f";
const usdcAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

describe("Cancel Order Test", function () {
    it("Should cancel Aave order", async function () {
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
        });

        const deployer = await ethers.provider.getSigner(
            "0xAb7677859331f95F25A3e7799176f7239feb5C44"
        );
        deployer.address = deployer._address;

        console.log(
            "Deploying contracts with the account:",
            deployer.address, "\n"
        );

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

        // Deploy Symphony Contract
        const Symphony = await ethers.getContractFactory("Symphony");

        let symphony = await upgrades.deployProxy(
            Symphony,
            [
                deployer.address,
                deployer.address,
                40, // 40 for 0.4 %
            ]
        );

        await symphony.deployed();
        console.log("Symphony contract deployed to:", symphony.address, "\n");

        symphony = new ethers.Contract(
            symphony.address,
            SymphonyArtifacts.abi,
            deployer
        );

        const approveAmount = new BigNumber(100)
            .times(
                new BigNumber(10)
                    .exponentiatedBy(new BigNumber(18))
            )
            .toString();

        await daiContract.approve(symphony.address, approveAmount);
        await usdcContract.approve(symphony.address, approveAmount);

        expect(await symphony.totalAssetShares(usdcAddress)).to.eq(0);

        const inputAmount = new BigNumber(10).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();

        const minReturnAmount = new BigNumber(15).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(18))
        ).toString();

        const stoplossAmount = new BigNumber(8).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(18))
        ).toString();

        const AaveYield = await ethers.getContractFactory("AaveYield");

        const configParams = config.mainnet;
        const aaveYield = await upgrades.deployProxy(
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
        console.log("Aave Yield contract deployed to:", aaveYield.address, "\n");

        await symphony.updateStrategy(
            usdcAddress,
            aaveYield.address,
        );

        await symphony.updateBufferPercentage(
            usdcAddress,
            4000, // 40%
        );

        // Create Order
        await symphony.createOrder(
            deployer.address,
            usdcAddress,
            daiAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount
        );

        const inputAmount1 = new BigNumber(10).times(
            new BigNumber(20).exponentiatedBy(new BigNumber(6))
        ).toString();

        console.log("Advancing 100 blocks..");
        for (let i = 0; i < 1000; ++i) {
            await time.advanceBlock();
        };

        // Create Order
        const tx = await symphony.createOrder(
            deployer.address,
            usdcAddress,
            daiAddress,
            inputAmount1,
            minReturnAmount,
            stoplossAmount
        );

        const receipt = await tx.wait();
        const events = receipt.events.filter((x) => { return x.event == "OrderCreated" });

        const orderId = events[0].args[0];
        const orderData = events[0].args[1];

        console.log("orderRewardDebt: ", Number(await aaveYield.orderRewardDebt(orderId)));
        console.log("pendingRewards: ", Number(await aaveYield.pendingRewards(usdcAddress)));
        console.log("previousAccRewardPerShare: ", Number(await aaveYield.previousAccRewardPerShare(usdcAddress)));

        await symphony.cancelOrder(
            orderId,
            orderData
        );

        console.log(Number(await aaveYield.userReward(deployer.address)));
    });

    it("Should cancel Mstable order", async function () {
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
        });

        const deployer = await ethers.provider.getSigner(
            "0xAb7677859331f95F25A3e7799176f7239feb5C44"
        );
        deployer.address = deployer._address;

        console.log(
            "Deploying contracts with the account:",
            deployer.address, "\n"
        );

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

        // Deploy Symphony Contract
        const Symphony = await ethers.getContractFactory("Symphony");

        let symphony = await upgrades.deployProxy(
            Symphony,
            [
                deployer.address,
                deployer.address,
                40, // 40 for 0.4 %
            ]
        );

        await symphony.deployed();
        console.log("Symphony contract deployed to:", symphony.address, "\n");

        symphony = new ethers.Contract(
            symphony.address,
            SymphonyArtifacts.abi,
            deployer
        );

        const approveAmount = new BigNumber(100)
            .times(
                new BigNumber(10)
                    .exponentiatedBy(new BigNumber(18))
            )
            .toString();

        await daiContract.approve(symphony.address, approveAmount);
        await usdcContract.approve(symphony.address, approveAmount);

        expect(await symphony.totalAssetShares(usdcAddress)).to.eq(0);

        const inputAmount = new BigNumber(10).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();

        const minReturnAmount = new BigNumber(15).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(18))
        ).toString();

        const stoplossAmount = new BigNumber(8).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(18))
        ).toString();

        const MstableYield = await ethers.getContractFactory("MockMstableYield");

        const configParams = config.mainnet;
        let mstableYield = await upgrades.deployProxy(
            MstableYield,
            [
                configParams.musdTokenAddress,
                configParams.mstableSavingContract,
                symphony.address,
            ]
        );

        await mstableYield.deployed();
        console.log("Mstable Yield contract deployed to:", mstableYield.address, "\n");

        await symphony.updateStrategy(
            usdcAddress,
            mstableYield.address,
        );

        await symphony.updateBufferPercentage(
            usdcAddress,
            40, // 40%
        );

        // Create Order
        const tx = await symphony.createOrder(
            deployer.address,
            usdcAddress,
            daiAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount
        );

        const receipt = await tx.wait();
        const events = receipt.events.filter((x) => { return x.event == "OrderCreated" });

        const orderId = events[0].args[0];
        const orderData = events[0].args[1];

        // console.log("Advancing 100 blocks..");
        // for (let i = 0; i < 1000; ++i) {
        //     await time.advanceBlock();
        // };

        // Create Order
        const tx1 = await symphony.createOrder(
            deployer.address,
            usdcAddress,
            daiAddress,
            inputAmount,
            minReturnAmount,
            0
        );

        const receipt1 = await tx1.wait();
        const events1 = receipt1.events.filter((x) => { return x.event == "OrderCreated" });

        const orderId1 = events1[0].args[0];
        const orderData1 = events1[0].args[1];

        await symphony.cancelOrder(
            orderId1,
            orderData1
        );

        await symphony.cancelOrder(
            orderId,
            orderData
        );
    });
});
