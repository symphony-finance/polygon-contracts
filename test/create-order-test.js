const { expect } = require("chai");
const { default: BigNumber } = require("bignumber.js");
const config = require("../config/index.json");
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

const daiAddress = "0x6b175474e89094c44da98b954eedeac495271d0f";
const usdcAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const recipient = "0xAb7677859331f95F25A3e7799176f7239feb5C44";
const executor = "0xAb7677859331f95F25A3e7799176f7239feb5C44";

let inputAmount = new BigNumber(10).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(6))
).toString();

let minReturnAmount = new BigNumber(15).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(18))
).toString();

let stoplossAmount = new BigNumber(8).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(18))
).toString();

const approveAmount = new BigNumber(100)
    .times(
        new BigNumber(10)
            .exponentiatedBy(new BigNumber(18))
    )
    .toString();

describe("Create Order Test", () => {
    it("Should create multiple orders (diff ids) with no yield strategy", async () => {
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

        // Deploy Yolo Contract
        const Yolo = await ethers.getContractFactory("Yolo");

        let yolo = await upgrades.deployProxy(
            Yolo,
            [
                deployer.address,
                deployer.address,
                40, // 40 for 0.4 %,
                ZERO_ADDRESS
            ]
        );

        await yolo.deployed();

        yolo = new ethers.Contract(
            yolo.address,
            YoloArtifacts.abi,
            deployer
        );

        await daiContract.approve(yolo.address, approveAmount);
        await usdcContract.approve(yolo.address, approveAmount);

        expect(await yolo.totalAssetShares(usdcAddress)).to.eq(0);

        await yolo.addWhitelistAsset(usdcAddress);

        // Create 1st Order
        await yolo.createOrder(
            recipient,
            usdcAddress,
            daiAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount,
            executor
        );

        // Create New Order
        const newstoploss =
            new BigNumber(7).times(
                new BigNumber(10).exponentiatedBy(new BigNumber(6))
            ).toString();

        await yolo.createOrder(
            recipient,
            usdcAddress,
            daiAddress,
            inputAmount,
            minReturnAmount,
            newstoploss,
            executor
        );
    });

    it("Should create order with MATIC token", async () => {
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
        });

        const deployer = await ethers.provider.getSigner(
            "0xAb7677859331f95F25A3e7799176f7239feb5C44"
        );
        deployer.address = deployer._address;

        const configParams = config.mainnet;

        // Deploy Yolo Contract
        const Yolo = await ethers.getContractFactory("MockYolo");

        let yolo = await upgrades.deployProxy(
            Yolo,
            [
                deployer.address,
                deployer.address,
                40, // 40 for 0.4 %
                ZERO_ADDRESS,
            ]
        );

        await yolo.deployed();

        yolo = new ethers.Contract(
            yolo.address,
            YoloArtifacts.abi,
            deployer
        );

        const Treasury = await ethers.getContractFactory("Treasury");
        const treasury = await upgrades.deployProxy(
            Treasury,
            [deployer.address]
        );
        await treasury.deployed();
        await yolo.updateTreasury(treasury.address);

        await yolo.addWhitelistAsset(configParams.wethAddress);

        const depositAmount = new BigNumber(10).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(18))
        ).toString();

        const minReturnAmount = new BigNumber(15).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();

        const stoplossAmount = new BigNumber(8).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();

        // Create Order
        const receipt = await yolo.createNativeOrder(
            deployer.address,
            usdcAddress,
            minReturnAmount,
            stoplossAmount,
            executor,
            { value: depositAmount }
        );

        const block = await ethers.provider.getBlock(receipt.blockHash);

        const orderId = await yolo.getOrderId(
            deployer.address,
            deployer.address,
            configParams.wethAddress,
            usdcAddress,
            depositAmount,
            minReturnAmount,
            stoplossAmount,
            executor,
            block.timestamp
        );

        expect(
            await yolo.totalAssetShares(configParams.wethAddress)
        ).to.eq(depositAmount);

        const orderHash = await yolo.orderHash(orderId);

        const abiCoder = new ethers.utils.AbiCoder();
        const abi = [
            "address",
            "address",
            "address",
            "address",
            "uint256",
            "uint256",
            "uint256",
            "uint256",
            "address",
        ];

        const shareAmount = depositAmount;

        const enocodedData = abiCoder.encode(
            abi,
            [
                deployer.address,
                deployer.address,
                configParams.wethAddress,
                usdcAddress,
                depositAmount,
                minReturnAmount,
                stoplossAmount,
                shareAmount,
                executor,
            ]
        );

        expect(orderHash).to.eq(ethers.utils.keccak256(enocodedData));
    });

    it("Should create order with extreme values", async () => {
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

        // Deploy Yolo Contract
        const Yolo = await ethers.getContractFactory("Yolo");

        let yolo = await upgrades.deployProxy(
            Yolo,
            [
                deployer.address,
                deployer.address,
                40, // 40 for 0.4 %,
                ZERO_ADDRESS
            ]
        );

        await yolo.deployed();

        yolo = new ethers.Contract(
            yolo.address,
            YoloArtifacts.abi,
            deployer
        );

        await daiContract.approve(yolo.address, approveAmount);
        await usdcContract.approve(yolo.address, approveAmount);

        expect(await yolo.totalAssetShares(usdcAddress)).to.eq(0);

        await yolo.addWhitelistAsset(usdcAddress);

        // check the state changes
        let totalSharesBefore = await yolo.totalAssetShares(
            usdcAddress
        );

        expect(totalSharesBefore).to.eq(0);

        const inputAmount1 = 1;
        const minReturnAmount1 = 2;

        // Create Order 1 USDC  
        await yolo.createOrder(
            recipient,
            usdcAddress,
            daiAddress,
            inputAmount1,
            minReturnAmount1,
            0,
            executor,
        );

        // check the state changes
        let totalSharesAfter = await yolo.totalAssetShares(
            usdcAddress
        );

        expect(totalSharesAfter).to.eq(1);

        totalSharesBefore = await yolo.totalAssetShares(
            usdcAddress
        );

        expect(totalSharesBefore).to.eq(1);

        const inputAmount2 = new BigNumber(10000000).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();

        const minReturnAmount2 = new BigNumber(20000000).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();

        await yolo.createOrder(
            recipient,
            usdcAddress,
            daiAddress,
            inputAmount2,
            minReturnAmount2,
            0,
            executor
        );

        totalSharesAfter = await yolo.totalAssetShares(
            usdcAddress
        );
        expect(totalSharesAfter).to.eq(10000000000001);
    });

    it("Should create order with yield strategy & 0% buffer", async () => {
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

        // Deploy Yolo Contract
        const Yolo = await ethers.getContractFactory("Yolo");

        let yolo = await upgrades.deployProxy(
            Yolo,
            [
                deployer.address,
                deployer.address,
                40, // 40 for 0.4 %
                ZERO_ADDRESS,
            ]
        );

        await yolo.deployed();

        yolo = new ethers.Contract(
            yolo.address,
            YoloArtifacts.abi,
            deployer
        );

        await usdcContract.approve(yolo.address, approveAmount);

        const AaveYield = await ethers.getContractFactory("AaveYield");

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

        await yolo.setStrategy(
            usdcAddress,
            aaveYield.address,
        );

        await yolo.updateBufferPercentage(
            usdcAddress,
            0, // 40%
        );

        await yolo.addWhitelistAsset(usdcAddress);

        // Create Order
        const tx = await yolo.createOrder(
            recipient,
            usdcAddress,
            daiAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount,
            executor,
        );

        const receipt = await tx.wait();

        const orderStatus = await getOrderStatus(
            yolo,
            receipt,
            deployer.address
        );

        expect(orderStatus).to.be.true;

        // expect(await usdcContract.balanceOf(yolo.address)).to.eq(0);

        // aaveYield = new ethers.Contract(
        //     aaveYield.address,
        //     AaveYieldArtifacts.abi,
        //     deployer
        // );

        // expect(Number(await aaveYield.getTotalUnderlying(usdcAddress)))
        //     .to.greaterThanOrEqual(Number(inputAmount) - 1);
    });

    it("Should create order with yield strategy & 100% buffer", async () => {
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

        // Deploy Yolo Contract
        const Yolo = await ethers.getContractFactory("Yolo");

        let yolo = await upgrades.deployProxy(
            Yolo,
            [
                deployer.address,
                deployer.address,
                40, // 40 for 0.4 %
                ZERO_ADDRESS,
            ]
        );

        await yolo.deployed();

        yolo = new ethers.Contract(
            yolo.address,
            YoloArtifacts.abi,
            deployer
        );

        await usdcContract.approve(yolo.address, approveAmount);

        const AaveYield = await ethers.getContractFactory("AaveYield");

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

        await yolo.setStrategy(
            usdcAddress,
            aaveYield.address,
        );

        await yolo.updateBufferPercentage(
            usdcAddress,
            10000, // 100%
        );

        await yolo.addWhitelistAsset(usdcAddress);

        // Create Order
        const tx = await yolo.createOrder(
            recipient,
            usdcAddress,
            daiAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount,
            executor
        );

        const receipt = await tx.wait();

        const orderStatus = await getOrderStatus(
            yolo,
            receipt,
            recipient
        );

        expect(orderStatus).to.be.true;

        expect(await usdcContract.balanceOf(yolo.address)).to.eq(inputAmount);
    });

    it("Should create order with Aave Yield Strategy", async () => {
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

        // Deploy Yolo Contract
        const Yolo = await ethers.getContractFactory("Yolo");

        let yolo = await upgrades.deployProxy(
            Yolo,
            [
                deployer.address,
                deployer.address,
                40, // 40 for 0.4 %
                ZERO_ADDRESS,
            ]
        );

        await yolo.deployed();

        yolo = new ethers.Contract(
            yolo.address,
            YoloArtifacts.abi,
            deployer
        );

        await usdcContract.approve(yolo.address, approveAmount);

        expect(await yolo.totalAssetShares(usdcAddress)).to.eq(0);

        const AaveYield = await ethers.getContractFactory("AaveYield");

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

        await yolo.setStrategy(
            usdcAddress,
            aaveYield.address,
        );

        const bufferPercent = 40; // 40%

        await yolo.updateBufferPercentage(
            usdcAddress,
            bufferPercent * 100, // 4000
        );

        await yolo.addWhitelistAsset(usdcAddress);

        // Create Order
        const tx = await yolo.createOrder(
            recipient,
            usdcAddress,
            daiAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount,
            executor
        );

        expect(await yolo.totalAssetShares(usdcAddress)).to.eq(inputAmount);

        const receipt = await tx.wait();

        const orderStatus = await getOrderStatus(
            yolo,
            receipt,
            recipient
        );

        expect(orderStatus).to.be.true;

        expect(Number(await usdcContract.balanceOf(yolo.address))).to.eq(
            Number(new BigNumber(inputAmount).times(
                new BigNumber(bufferPercent / 100)
            ))
        );
        expect(Number(await aaveYield.getTotalUnderlying(usdcAddress)))
            .to.greaterThanOrEqual(
                Number(new BigNumber(inputAmount).times(
                    new BigNumber((100 - bufferPercent) / 100)
                ))
            );
    });

    it("Shouldn't create order when paused & create when unpaused", async () => {
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

        // Deploy Yolo Contract
        const Yolo = await ethers.getContractFactory("Yolo");

        let yolo = await upgrades.deployProxy(
            Yolo,
            [
                deployer.address,
                deployer.address,
                40, // 40 for 0.4 %
                ZERO_ADDRESS,
            ]
        );

        await yolo.deployed();

        yolo = new ethers.Contract(
            yolo.address,
            YoloArtifacts.abi,
            deployer
        );

        const approveAmount = new BigNumber(100)
            .times(
                new BigNumber(10)
                    .exponentiatedBy(new BigNumber(18))
            )
            .toString();

        await usdcContract.approve(yolo.address, approveAmount);

        await yolo.pause();
        await yolo.addWhitelistAsset(usdcAddress);

        await expect(
            yolo.createOrder(
                recipient,
                usdcAddress,
                daiAddress,
                inputAmount,
                minReturnAmount,
                stoplossAmount,
                executor
            )
        ).to.be.revertedWith(
            'Pausable: paused'
        );

        await yolo.unpause();

        const tx = await yolo.createOrder(
            recipient,
            usdcAddress,
            daiAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount,
            executor
        );

        const receipt = await tx.wait();

        const orderStatus = await getOrderStatus(
            yolo,
            receipt,
            deployer.address
        );

        expect(orderStatus).to.be.true;
    });

    // it("Shouldn't create order with same order id", async () => {
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

    //     // Deploy Yolo Contract
    //     const Yolo = await ethers.getContractFactory("Yolo");

    //     let yolo = await upgrades.deployProxy(
    //         Yolo,
    //         [
    //             deployer.address,
    //             deployer.address,
    //             40, // 40 for 0.4 %
    //             ZERO_ADDRESS,
    //         ]
    //     );

    //     await yolo.deployed();

    //     yolo = new ethers.Contract(
    //         yolo.address,
    //         YoloArtifacts.abi,
    //         deployer
    //     );

    //     await usdcContract.approve(yolo.address, approveAmount);

    //     await yolo.addWhitelistAsset(usdcAddress);

    //     // Create Order
    //     await yolo.createOrder(
    //         recipient,
    //         usdcAddress,
    //         daiAddress,
    //         inputAmount,
    //         minReturnAmount,
    //         stoplossAmount,
    //         executor
    //     );

    //     await expect(
    //         yolo.createOrder(
    //             recipient,
    //             usdcAddress,
    //             daiAddress,
    //             inputAmount,
    //             minReturnAmount,
    //             stoplossAmount,
    //             executor
    //         )
    //     ).to.be.revertedWith(
    //         'Yolo::createOrder: There is already an existing order with same id'
    //     );
    // });
});

const getOrderStatus = (
    yolo,
    receipt,
    recipient
) => {
    return new Promise(async (resolve) => {
        const events = receipt.events.filter((x) => { return x.event == "OrderCreated" });

        const orderId = events[0].args[0];
        const orderData = events[0].args[1];

        const block = await ethers.provider.getBlock(receipt.blockHash);
        const creator = recipient;

        const _orderId = await yolo.getOrderId(
            creator,
            recipient,
            usdcAddress,
            daiAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount,
            executor,
            block.timestamp
        );

        expect(orderId).to.eq(_orderId);

        const abiCoder = new ethers.utils.AbiCoder();
        const abi = [
            "address",
            "address",
            "address",
            "address",
            "uint256",
            "uint256",
            "uint256",
            "uint256",
            "address",
        ];

        const decodedData = abiCoder.decode(abi, orderData);

        expect(decodedData[0].toLowerCase()).to.eq(creator.toLowerCase());
        expect(decodedData[1].toLowerCase()).to.eq(recipient.toLowerCase());
        expect(decodedData[2].toLowerCase()).to.eq(usdcAddress.toLowerCase());
        expect(decodedData[3].toLowerCase()).to.eq(daiAddress.toLowerCase());
        expect(decodedData[4]).to.eq(inputAmount);
        expect(decodedData[5]).to.eq(minReturnAmount);
        expect(decodedData[6]).to.eq(stoplossAmount);
        expect(decodedData[7]).to.eq(inputAmount);

        resolve(true);
    });
}
