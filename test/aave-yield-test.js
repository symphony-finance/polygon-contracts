const { expect } = require("chai");
const { default: BigNumber } = require("bignumber.js");
const config = require("../config/index.json");
const { time } = require("@openzeppelin/test-helpers");
const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants");

const AaveYieldArtifacts = require(
    "../artifacts/contracts/mocks/MockAaveYield.sol/MockAaveYield.json"
);
const SymphonyArtifacts = require(
    "../artifacts/contracts/Symphony.sol/Symphony.json"
);
const IERC20Artifacts = require(
    "../artifacts/contracts/mocks/TestERC20.sol/TestERC20.json"
);

const daiAddress = "0x6b175474e89094c44da98b954eedeac495271d0f";
const usdcAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

const recipient = "0xAb7677859331f95F25A3e7799176f7239feb5C44";
const rewardToken = "0x4da27a545c0c5b758a6ba100e3a049001de870f5";
const inputAmount = new BigNumber(10).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(6))
).toString();
const minReturnAmount = new BigNumber(15).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(18))
).toString();
const stoplossAmount = new BigNumber(8).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(18))
).toString();
const approveAmount = new BigNumber(100).times(
    new BigNumber(10)
        .exponentiatedBy(new BigNumber(18))
).toString();

const mockOrderId1 = "0x185e828f7ffdecd32d6b798f2329162c7aef7f746dea4feeec5db8cad22f9ec3";
const mockOrderId2 = "0x5def443a23a192eb926fc873821e4a238172fc8ae0dedf7849e1c4f70fafb7b1";
const mockOrderId3 = "0x7ec48076ae6f278fe1f2de1c992213a9e388749bca78c4ea150f0f4d0f92d3c8";

describe("Aave Yield Test", () => {
    // TODO: Correct it
    it("should work for large reward", async () => {
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
        });

        const deployer = await ethers.provider.getSigner(
            "0xAb7677859331f95F25A3e7799176f7239feb5C44"
        );
        deployer.address = deployer._address;

        const AaveYield = await ethers.getContractFactory("MockAaveYield");

        const configParams = config.mainnet;
        let aaveYield = await upgrades.deployProxy(
            AaveYield,
            [
                deployer.address,
                deployer.address,
                configParams.aaveLendingPool,
                configParams.aaveProtocolDataProvider,
                configParams.aaveIncentivesController
            ]
        );

        aaveYield = new ethers.Contract(
            aaveYield.address,
            AaveYieldArtifacts.abi,
            deployer
        );

        // Alice's Order
        await aaveYield.setOrderRewardDebt(
            mockOrderId1,
            usdcAddress,
            10000000,
            0,
            0
        );

        expect(await aaveYield.orderRewardDebt(mockOrderId1)).to.eq(0);
        expect(await aaveYield.pendingRewards(usdcAddress)).to.eq(0);
        expect(await aaveYield.previousAccRewardPerShare(usdcAddress)).to.eq(0);

        // Bob's Order
        await aaveYield.setOrderRewardDebt(
            mockOrderId2,
            usdcAddress,
            10000000,
            10000000,
            2000000
        );

        expect(await aaveYield.orderRewardDebt(mockOrderId2)).to.eq(2000000);
        expect(await aaveYield.pendingRewards(usdcAddress)).to.eq(2000000);
        expect(await aaveYield.previousAccRewardPerShare(usdcAddress)).to.eq(
            new BigNumber(0.2).times(
                new BigNumber(10).exponentiatedBy(new BigNumber(18))
            ).toString()
        );

        // Charlie's Order
        await aaveYield.setOrderRewardDebt(
            mockOrderId3,
            usdcAddress,
            10000000,
            20000000,
            4000000
        );

        expect(await aaveYield.orderRewardDebt(mockOrderId3)).to.eq(3000000);
        expect(await aaveYield.pendingRewards(usdcAddress)).to.eq(4000000);
        expect(await aaveYield.previousAccRewardPerShare(usdcAddress)).to.eq(
            new BigNumber(0.3).times(
                new BigNumber(10).exponentiatedBy(new BigNumber(18))
            ).toString()
        );

        // Withraw Bob's Order
        await aaveYield.withdraw(
            usdcAddress, // underlying asset
            0,  // asset withdraw amount
            10000000, // order shares
            30000000, // total shares
            deployer.address, // recipient
            mockOrderId2, // order id
            4000000 // total reward balance
        );
        expect(await aaveYield.pendingRewards(usdcAddress)).to.eq(4000000);
        expect(await aaveYield.userReward(deployer.address)).to.eq(1000000);

        // Withraw Alice's Order
        await aaveYield.withdraw(
            usdcAddress,
            0,
            10000000,
            20000000,
            deployer.address,
            mockOrderId1,
            4000000
        );
        expect(await aaveYield.pendingRewards(usdcAddress)).to.eq(4000000);
        expect(await aaveYield.userReward(deployer.address)).to.eq(4000000);
    });

    // TODO: Correct it
    it("should work for small reward", async () => {
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
        });

        const deployer = await ethers.provider.getSigner(
            "0xAb7677859331f95F25A3e7799176f7239feb5C44"
        );
        deployer.address = deployer._address;

        const AaveYield = await ethers.getContractFactory("MockAaveYield");

        const configParams = config.mainnet;
        let aaveYield = await upgrades.deployProxy(
            AaveYield,
            [
                deployer.address,
                deployer.address,
                configParams.aaveLendingPool,
                configParams.aaveProtocolDataProvider,
                configParams.aaveIncentivesController
            ]
        );

        aaveYield = new ethers.Contract(
            aaveYield.address,
            AaveYieldArtifacts.abi,
            deployer
        );

        // Alice's Order
        await aaveYield.setOrderRewardDebt(
            mockOrderId1,
            usdcAddress,
            1000000,
            0,
            0
        );

        expect(await aaveYield.orderRewardDebt(mockOrderId1)).to.eq(0);
        expect(await aaveYield.pendingRewards(usdcAddress)).to.eq(0);
        expect(await aaveYield.previousAccRewardPerShare(usdcAddress)).to.eq(0);

        // Bob's Order
        await aaveYield.setOrderRewardDebt(
            mockOrderId2,
            usdcAddress,
            1000000,
            1000000,
            1
        );

        expect(await aaveYield.orderRewardDebt(mockOrderId2)).to.eq(1);
        expect(await aaveYield.pendingRewards(usdcAddress)).to.eq(1);
        expect(await aaveYield.previousAccRewardPerShare(usdcAddress)).to.eq(1000000000000);

        // Charlie's Order
        await aaveYield.setOrderRewardDebt(
            mockOrderId3,
            usdcAddress,
            1000000,
            2000000,
            5
        );

        expect(await aaveYield.orderRewardDebt(mockOrderId3)).to.eq(3);
        expect(await aaveYield.pendingRewards(usdcAddress)).to.eq(5);
        expect(await aaveYield.previousAccRewardPerShare(usdcAddress)).to.eq(3000000000000);

        // Withraw Bob's Order
        await aaveYield.withdraw(
            usdcAddress, // underlying asset
            0,  // asset withdraw amount
            1000000, // order shares
            3000000, // total shares
            recipient, // recipient
            mockOrderId2, // order id
            8 // total reward balance
        );

        expect(await aaveYield.pendingRewards(usdcAddress)).to.eq(8);
        expect(await aaveYield.userReward(recipient)).to.eq(3);

        await aaveYield.updatePendingReward(usdcAddress, 1);

        // Withraw Alice's Order
        await aaveYield.withdraw(
            usdcAddress,
            0,
            1000000,
            2000000,
            recipient,
            mockOrderId1,
            7
        );

        expect(await aaveYield.userReward(recipient)).to.eq(7);

        // Withraw Charlie's Order
        await aaveYield.withdraw(
            usdcAddress,
            0,
            1000000,
            1000000,
            recipient,
            mockOrderId3,
            7
        );

        expect(await aaveYield.userReward(recipient)).to.eq(8);
    });

    it("should transfer the reward to recipient for single order", async () => {
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
        });

        let deployer = await ethers.provider.getSigner(
            "0xAb7677859331f95F25A3e7799176f7239feb5C44"
        );
        deployer.address = deployer._address;

        // Create USDC contract instance
        const usdcContract = new ethers.Contract(
            usdcAddress,
            IERC20Artifacts.abi,
            deployer
        );

        // Create Reward Token contract instance
        const rewardTokenContract = new ethers.Contract(
            rewardToken,
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
                ZERO_ADDRESS
            ]
        );

        await symphony.deployed();

        symphony = new ethers.Contract(
            symphony.address,
            SymphonyArtifacts.abi,
            deployer
        );

        const AaveYield = await ethers.getContractFactory("AaveYield");

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

        aaveYield = new ethers.Contract(
            aaveYield.address,
            AaveYieldArtifacts.abi,
            deployer
        );

        await symphony.updateStrategy(usdcAddress, aaveYield.address,);
        await symphony.updateBufferPercentage(usdcAddress, 4000);

        await symphony.addWhitelistAsset(usdcAddress);

        await usdcContract.approve(symphony.address, approveAmount);

        // Create USDC Order
        const tx = await symphony.createOrder(
            recipient,
            usdcAddress,
            daiAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount
        );

        const orderReceipt = await tx.wait();
        const orderEvents = orderReceipt.events
            .filter((x) => {
                return x.event == "OrderCreated"
            });
        const orderId = orderEvents[0].args[0];
        const orderData = orderEvents[0].args[1];

        // Advancing 100 blocks
        for (let i = 0; i < 100; ++i) {
            await time.advanceBlock();
        };

        const totalReward = await aaveYield.getRewardBalance();
        const userRewardBalBefore = await rewardTokenContract
            .balanceOf(recipient);

        // Cancel Order
        await symphony.cancelOrder(orderId, orderData);

        const userRewardBalAfter = await rewardTokenContract
            .balanceOf(recipient);

        expect(Number(userRewardBalAfter)).to.be
            .greaterThanOrEqual(Number(userRewardBalBefore.add(totalReward)));
    });

    // TODO: Complete this test
    it("should transfer the reward to recipient in case multiple orders", async () => {
    });
});
