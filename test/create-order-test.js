const { expect } = require("chai");
const { default: BigNumber } = require("bignumber.js");
const config = require("../config/index.json");
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

        // Deploy Symphony Contract
        const Symphony = await ethers.getContractFactory("Symphony");

        let symphony = await upgrades.deployProxy(
            Symphony,
            [
                deployer.address,
                deployer.address,
                40, // 40 for 0.4 %,
                ZERO_ADDRESS
            ]
        );

        await symphony.deployed();

        symphony = new ethers.Contract(
            symphony.address,
            SymphonyArtifacts.abi,
            deployer
        );

        await daiContract.approve(symphony.address, approveAmount);
        await usdcContract.approve(symphony.address, approveAmount);

        expect(await symphony.totalAssetShares(usdcAddress)).to.eq(0);

        await symphony.addWhitelistAsset(usdcAddress);

        // Create 1st Order
        await symphony.createOrder(
            deployer.address,
            usdcAddress,
            daiAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount
        );

        // Create New Order
        const newstoploss =
            new BigNumber(7).times(
                new BigNumber(10).exponentiatedBy(new BigNumber(6))
            ).toString();

        await symphony.createOrder(
            deployer.address,
            usdcAddress,
            daiAddress,
            inputAmount,
            minReturnAmount,
            newstoploss
        );
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
        const tx = await symphony.createOrder(
            deployer.address,
            usdcAddress,
            daiAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount
        );

        const receipt = await tx.wait();

        const orderStatus = await getOrderStatus(
            symphony,
            receipt,
            deployer.address
        );

        expect(orderStatus).to.be.true;

        expect(await usdcContract.balanceOf(symphony.address)).to.eq(0);

        aaveYield = new ethers.Contract(
            aaveYield.address,
            AaveYieldArtifacts.abi,
            deployer
        );

        expect(Number(await aaveYield.getTotalUnderlying(usdcAddress)))
            .to.greaterThanOrEqual(Number(inputAmount) - 1);
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
            10000, // 100%
        );

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

        const orderStatus = await getOrderStatus(
            symphony,
            receipt,
            deployer.address
        );

        expect(orderStatus).to.be.true;

        expect(await usdcContract.balanceOf(symphony.address)).to.eq(inputAmount);
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

        expect(await symphony.totalAssetShares(usdcAddress)).to.eq(0);

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

        const bufferPercent = 40; // 40%

        await symphony.updateBufferPercentage(
            usdcAddress,
            bufferPercent * 100, // 4000
        );

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

        expect(await symphony.totalAssetShares(usdcAddress)).to.eq(inputAmount);

        const receipt = await tx.wait();

        const orderStatus = await getOrderStatus(
            symphony,
            receipt,
            deployer.address
        );

        expect(orderStatus).to.be.true;

        expect(Number(await usdcContract.balanceOf(symphony.address))).to.eq(
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

    it("Shouldn't create order with same order id", async () => {
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

        await symphony.addWhitelistAsset(usdcAddress);

        // Create Order
        await symphony.createOrder(
            deployer.address,
            usdcAddress,
            daiAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount
        );

        await expect(
            symphony.createOrder(
                deployer.address,
                usdcAddress,
                daiAddress,
                inputAmount,
                minReturnAmount,
                stoplossAmount
            )
        ).to.be.revertedWith(
            'Symphony::createOrder: There is already an existing order with same id'
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

        const approveAmount = new BigNumber(100)
            .times(
                new BigNumber(10)
                    .exponentiatedBy(new BigNumber(18))
            )
            .toString();

        await usdcContract.approve(symphony.address, approveAmount);

        await symphony.pause();
        await symphony.addWhitelistAsset(usdcAddress);

        await expect(
            symphony.createOrder(
                deployer.address,
                usdcAddress,
                daiAddress,
                inputAmount,
                minReturnAmount,
                stoplossAmount
            )
        ).to.be.revertedWith(
            'Pausable: paused'
        );

        await symphony.unpause();

        const tx = await symphony.createOrder(
            deployer.address,
            usdcAddress,
            daiAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount
        );

        const receipt = await tx.wait();

        const orderStatus = await getOrderStatus(
            symphony,
            receipt,
            deployer.address
        );

        expect(orderStatus).to.be.true;
    });

    // it("Should create order with Mstable Yield Strategy", async () => {
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

    //     // Deploy Symphony Contract
    //     const Symphony = await ethers.getContractFactory("Symphony");

    //     let symphony = await upgrades.deployProxy(
    //         Symphony,
    //         [
    //             deployer.address,
    //             deployer.address,
    //             40, // 40 for 0.4 %
    //             ZERO_ADDRESS,
    //         ]
    //     );

    //     await symphony.deployed();

    //     symphony = new ethers.Contract(
    //         symphony.address,
    //         SymphonyArtifacts.abi,
    //         deployer
    //     );

    //     await usdcContract.approve(symphony.address, approveAmount);

    //     expect(await symphony.totalAssetShares(usdcAddress)).to.eq(0);

    //     const MstableYield = await ethers.getContractFactory("MstableYield");

    //     const configParams = config.mainnet;
    //     const mstableYield = await upgrades.deployProxy(
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
    //         4000, // 40%
    //     );

    // await symphony.addWhitelistAsset(usdcAddress);

    //     // Create Order
    //     const tx = await symphony.createOrder(
    //         deployer.address,
    //         usdcAddress,
    //         daiAddress,
    //         inputAmount,
    //         minReturnAmount,
    //         stoplossAmount
    //     );

    //     expect(await symphony.totalAssetShares(usdcAddress)).to.eq(inputAmount);

    //     const receipt = await tx.wait();

    //     const orderStatus = await getOrderStatus(
    //         symphony,
    //         receipt,
    //         deployer.address
    //     );

    //     expect(orderStatus).to.be.true;
    // });
});

const getOrderStatus = (
    symphony,
    receipt,
    recipient
) => {
    return new Promise(async (resolve) => {
        const events = receipt.events.filter((x) => { return x.event == "OrderCreated" });

        const orderId = events[0].args[0];
        const orderData = events[0].args[1];

        const _orderId = await symphony.getOrderId(
            recipient,
            usdcAddress,
            daiAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount
        );

        expect(orderId).to.eq(_orderId);

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

        expect(decodedData[0].toLowerCase()).to.eq(recipient.toLowerCase());
        expect(decodedData[1].toLowerCase()).to.eq(usdcAddress.toLowerCase());
        expect(decodedData[2].toLowerCase()).to.eq(daiAddress.toLowerCase());
        expect(decodedData[3]).to.eq(inputAmount);
        expect(decodedData[4]).to.eq(minReturnAmount);
        expect(decodedData[5]).to.eq(stoplossAmount);
        expect(decodedData[6]).to.eq(inputAmount);

        resolve(true);
    });
}
