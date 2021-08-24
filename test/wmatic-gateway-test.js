const { expect } = require("chai");
const config = require("../config/index.json");
const { default: BigNumber } = require("bignumber.js");

const usdcAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

describe("WMATICGateway Test", function () {
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
        console.log(
            "Deploying contracts with the account:",
            deployer.address, "\n"
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

        // Deploy WMATICGateway Contract
        const WETHGateway = await ethers.getContractFactory("WMATICGateway");

        let wethGateway = await upgrades.deployProxy(
            WETHGateway,
            [
                configParams.wethAddress,
                deployer.address,
                symphony.address,
            ]
        );

        await wethGateway.deployed();
        console.log("WETHGateway deployed to:", wethGateway.address, "\n");

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
        const tx = await wethGateway.createMaticOrder(
            deployer.address,
            usdcAddress,
            minReturnAmount,
            stoplossAmount,
            { value: depositAmount }
        );

        const orderId = await symphony.getOrderId(
            deployer.address,
            configParams.wethAddress,
            usdcAddress,
            depositAmount,
            minReturnAmount,
            stoplossAmount
        );

        expect(
            await symphony.totalAssetShares(configParams.wethAddress)
        ).to.eq(depositAmount);

        const orderHash = await symphony.orderHash(orderId);

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

        const shareAmount = depositAmount;

        const enocodedData = abiCoder.encode(
            abi,
            [
                deployer.address,
                configParams.wethAddress,
                usdcAddress,
                depositAmount,
                minReturnAmount,
                stoplossAmount,
                shareAmount,
            ]
        );

        expect(orderHash).to.eq(ethers.utils.keccak256(enocodedData));
    });
});
