const { expect } = require("chai");
const config = require("../config/index.json");
const { AbiCoder } = require("ethers/lib/utils");
const { BigNumber: EthersBN } = require('ethers');
const { default: BigNumber } = require("bignumber.js");
const { time } = require("@openzeppelin/test-helpers");
const { ZERO_ADDRESS, ZERO_BYTES32 } =
    require("@openzeppelin/test-helpers/src/constants");

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

const inputAmount = new BigNumber(10).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(6))
).toString();

const minReturnAmount = new BigNumber(15).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(18))
).toString();

const stoplossAmount = new BigNumber(8).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(18))
).toString();

const approveAmount = new BigNumber(100)
    .times(
        new BigNumber(10)
            .exponentiatedBy(new BigNumber(18))
    )
    .toString();

describe("Cancel Order Test", () => {
    it("Should cancel order if no yield strategy", async () => {
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

        await usdcContract.approve(symphony.address, approveAmount);

        await symphony.addWhitelistAsset(usdcAddress);

        // Create Order
        const createTx = await symphony.createOrder(
            deployer.address,
            usdcAddress,
            daiAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount
        );

        const createTxReceipt = await createTx.wait();
        const createTxEvents = createTxReceipt.events.filter(
            (x) => { return x.event == "OrderCreated" }
        );
        const createTxOrderId = createTxEvents[0].args[0];
        const orderData = createTxEvents[0].args[1];

        const balanceBeforeCancellation = await usdcContract
            .balanceOf(deployer.address);

        const cancelTx = await symphony.cancelOrder(
            createTxOrderId,
            orderData
        );

        const cancelTxReceipt = await cancelTx.wait();
        const cancelTxEvents = cancelTxReceipt.events.filter(
            (x) => { return x.event == "OrderCancelled" }
        );
        const cancelTxOrderId = cancelTxEvents[0].args[0];

        expect(createTxOrderId).to.eq(cancelTxOrderId);

        const balanceAfterCancellation = await usdcContract
            .balanceOf(deployer.address);

        expect(balanceBeforeCancellation).to
            .eq(balanceAfterCancellation.sub(inputAmount));
    });

    it("Should cancel order with Aave yield strategy", async () => {
        let totalShares = 0;

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
                40, // 40 for 0.4 %
                ZERO_ADDRESS,
            ]
        );

        await symphony.deployed();

        symphony = new ethers.Contract(
            symphony.address,
            SymphonyArtifacts.abi,
            deployer
        );

        await usdcContract.approve(symphony.address, approveAmount);

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

        await symphony.updateStrategy(
            usdcAddress,
            aaveYield.address,
        );

        await symphony.updateBufferPercentage(
            usdcAddress,
            0, // 40%
        );

        await symphony.addWhitelistAsset(usdcAddress);

        // Create Order
        const tx1 = await symphony.createOrder(
            deployer.address,
            usdcAddress,
            daiAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount
        );

        const receipt1 = await tx1.wait();
        const events1 = receipt1.events.filter((x) => { return x.event == "OrderCreated" });
        const orderId1 = events1[0].args[0];
        const orderData1 = events1[0].args[1];

        totalShares = totalShares + getShareFromOrder(orderData1);

        const inputAmount1 = new BigNumber(11).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();

        // Advancing 100 blocks
        for (let i = 0; i < 100; ++i) {
            await time.advanceBlock();
        };

        // Create Order
        const tx2 = await symphony.createOrder(
            deployer.address,
            usdcAddress,
            daiAddress,
            inputAmount1,
            minReturnAmount,
            stoplossAmount
        );

        const receipt2 = await tx2.wait();
        const events2 = receipt2.events.filter((x) => { return x.event == "OrderCreated" });

        const orderId2 = events2[0].args[0];
        const orderData2 = events2[0].args[1];

        totalShares = totalShares + getShareFromOrder(orderData2);

        await symphony.cancelOrder(
            orderId2,
            orderData2
        );

        await symphony.cancelOrder(
            orderId1,
            orderData1
        );
    });

    it("Should cancel order when strategy removed after creating the order", async () => {
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

        const bufferPercent = 40;

        await symphony.updateStrategy(usdcAddress, aaveYield.address);
        await symphony.updateBufferPercentage(usdcAddress, bufferPercent * 100);

        await usdcContract.approve(symphony.address, approveAmount);

        await symphony.addWhitelistAsset(usdcAddress);

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

        expect(Number(await usdcContract.balanceOf(symphony.address))).to.eq(
            Number(new BigNumber(inputAmount).times(
                new BigNumber(bufferPercent / 100)
            ))
        );
        expect(Number(await aaveYield.getTotalUnderlying(usdcAddress))).to
            .greaterThanOrEqual(
                Number(new BigNumber(inputAmount).times(
                    new BigNumber((100 - bufferPercent) / 100)
                )) - 1
            );

        // Remove yield strategy
        await symphony.migrateStrategy(usdcAddress, ZERO_ADDRESS, encodedOrder);

        expect(Number(await usdcContract.balanceOf(symphony.address)))
            .to.be.greaterThanOrEqual(Number(inputAmount) - 1);
        expect(await aaveYield.getTotalUnderlying(usdcAddress)).to.eq(0);

        const usdcBalBeforeExecute = await usdcContract.balanceOf(deployer.address);

        // Execute Order
        await symphony.cancelOrder(orderId, orderData);

        const usdcBalAfterExecute = await usdcContract.balanceOf(deployer.address);

        expect(Number(usdcBalAfterExecute)).to.be
            .greaterThanOrEqual(Number(usdcBalBeforeExecute.add(inputAmount)));
    });

    it("Should cancel order when strategy migrated after creating the order", async () => {
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

        const bufferPercent = 40;

        await symphony.updateStrategy(usdcAddress, aaveYield.address);
        await symphony.updateBufferPercentage(usdcAddress, bufferPercent * 100);

        await usdcContract.approve(symphony.address, approveAmount);

        await symphony.addWhitelistAsset(usdcAddress);

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

        expect(Number(await usdcContract.balanceOf(symphony.address))).to.eq(
            Number(new BigNumber(inputAmount).times(
                new BigNumber(bufferPercent / 100)
            ))
        );
        expect(Number(await aaveYield.getTotalUnderlying(usdcAddress))).to
            .greaterThanOrEqual(
                Number(new BigNumber(inputAmount).times(
                    new BigNumber((100 - bufferPercent) / 100)
                )) - 1
            );

        const aaveYieldNew = await upgrades.deployProxy(
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

        // Migrate startegy to new contract
        await symphony.migrateStrategy(usdcAddress, aaveYieldNew.address, encodedOrder);

        expect(Number(await usdcContract.balanceOf(symphony.address))).to.eq(
            Number(new BigNumber(inputAmount).times(
                new BigNumber(bufferPercent / 100)
            ))
        );
        expect(Number(await aaveYieldNew.getTotalUnderlying(usdcAddress))).to.
            greaterThanOrEqual(
                Number(new BigNumber(inputAmount).times(
                    new BigNumber((100 - bufferPercent) / 100)
                )) - 1
            );
        expect(await aaveYield.getTotalUnderlying(usdcAddress)).to.eq(0);

        const usdcBalBeforeExecute = await usdcContract.balanceOf(deployer.address);

        // Execute Order
        await symphony.cancelOrder(orderId, orderData);

        const usdcBalAfterExecute = await usdcContract.balanceOf(deployer.address);

        expect(Number(usdcBalAfterExecute)).to.be
            .greaterThanOrEqual(Number(usdcBalBeforeExecute.add(inputAmount)));
    });

    // it("Should cancel order with Mstable yield strategy", async () => {
    //     await network.provider.request({
    //         method: "hardhat_impersonateAccount",
    //         params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
    //     });

    //     const deployer = await ethers.provider.getSigner(
    //         "0xAb7677859331f95F25A3e7799176f7239feb5C44"
    //     );
    //     deployer.address = deployer._address;

    //     // Create USDC contract instance
    //     const usdcContract = new ethers.Contract(
    //         usdcAddress,
    //         IERC20Artifacts.abi,
    //         deployer
    //     );

    //     // Create DAI contract instance
    //     const daiContract = new ethers.Contract(
    //         daiAddress,
    //         IERC20Artifacts.abi,
    //         deployer
    //     );

    //     // Deploy Symphony Contract
    //     const Symphony = await ethers.getContractFactory("Symphony");

    //     let symphony = await upgrades.deployProxy(
    //         Symphony,
    //         [
    //             deployer.address,
    //             deployer.address,
    //             40, // 40 for 0.4 %,
    //             ZERO_ADDRESS
    //         ]
    //     );

    //     await symphony.deployed();

    //     symphony = new ethers.Contract(
    //         symphony.address,
    //         SymphonyArtifacts.abi,
    //         deployer
    //     );

    //     await daiContract.approve(symphony.address, approveAmount);
    //     await usdcContract.approve(symphony.address, approveAmount);

    //     const MstableYield = await ethers.getContractFactory("MstableYield");

    //     const configParams = config.mainnet;
    //     let mstableYield = await upgrades.deployProxy(
    //         MstableYield,
    //         [
    //             configParams.musdTokenAddress,
    //             configParams.mstableSavingContract,
    //             symphony.address,
    //         ]
    //     );

    //     await mstableYield.deployed();

    //     await symphony.updateStrategy(
    //         usdcAddress,
    //         mstableYield.address,
    //     );

    //     await symphony.updateBufferPercentage(
    //         usdcAddress,
    //         0, // 40%
    //     );

    //     await symphony.addWhitelistAsset(usdcAddress);

    //     // Create Order
    //     const tx1 = await symphony.createOrder(
    //         deployer.address,
    //         usdcAddress,
    //         daiAddress,
    //         inputAmount,
    //         minReturnAmount,
    //         stoplossAmount
    //     );

    //     const receipt1 = await tx1.wait();
    //     const events1 = receipt1.events.filter(
    //         (x) => { return x.event == "OrderCreated" }
    //     );

    //     const orderId1 = events1[0].args[0];
    //     const orderData1 = events1[0].args[1];

    //     // Advancing 100 blocks
    //     for (let i = 0; i < 100; ++i) {
    //         await time.advanceBlock();
    //     };

    //     // Create Order
    //     const tx2 = await symphony.createOrder(
    //         deployer.address,
    //         usdcAddress,
    //         daiAddress,
    //         inputAmount,
    //         minReturnAmount,
    //         0
    //     );

    //     const receipt2 = await tx2.wait();
    //     const events2 = receipt2.events.filter(
    //         (x) => { return x.event == "OrderCreated" }
    //     );

    //     const orderId2 = events2[0].args[0];
    //     const orderData2 = events2[0].args[1];

    //     await symphony.cancelOrder(
    //         orderId2,
    //         orderData2
    //     );

    //     await symphony.cancelOrder(
    //         orderId1,
    //         orderData1
    //     );
    // });
});

const calculateReward = (aaveYield, orderId, orderData, totalShares) => {
    return new Promise(async (resolve) => {
        const totalAssetReward = await aaveYield.getRewardBalance(usdcAddress);
        const orderRewardDebt = await aaveYield.orderRewardDebt(orderId);

        const pendingRewards = await aaveYield.pendingRewards(usdcAddress);
        const previousACRPShare = await aaveYield.previousAccRewardPerShare(usdcAddress);

        const newReward = totalAssetReward.sub(pendingRewards);
        const newRewardPerShare = newReward.mul(
            new EthersBN.from(10).pow(new EthersBN.from(18))
        ).div(new EthersBN.from(totalShares));

        const accRewardPerShare = previousACRPShare.add(newRewardPerShare);
        const orderShares = new EthersBN.from(getShareFromOrder(orderData));

        const reward = orderShares.mul(accRewardPerShare).div(
            new EthersBN.from(10).pow(new EthersBN.from(18))
        ).sub(orderRewardDebt);

        resolve(reward)
    });
}

const getShareFromOrder = (orderData) => {
    const abiCoder = new ethers.utils.AbiCoder();
    const abi = [
        "address",
        "address",
        "address",
        "uint256",
        "uint256",
        "uint256",
        "uint256",
    ];

    const decodedData = abiCoder.decode(abi, orderData);
    return decodedData[6];
}

const encodedOrder = new AbiCoder().encode(
    ['address', 'uint256', 'bytes32', 'address[]'],
    [ZERO_ADDRESS, 0, ZERO_BYTES32, []]
);
