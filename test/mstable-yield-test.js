const { expect } = require("chai");
const { default: BigNumber } = require("bignumber.js");
const config = require("../config/index.json");
const {
    ZERO_ADDRESS,
} = require("@openzeppelin/test-helpers/src/constants");

const MstableYieldArtifacts = require(
    "../artifacts/contracts/adapters/MstableYield.sol/MstableYield.json"
);
const IERC20Artifacts = require(
    "../artifacts/contracts/mocks/TestERC20.sol/TestERC20.json"
);
const usdcAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const musdAddress = "0xe2f2a5C287993345a840Db3B0845fbC70f5935a5";

describe("Mstable Yield Test", function () {
    it("Should work for stablecoin as input", async function () {
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
                ZERO_ADDRESS,
            ]
        );

        const MstableYield = await ethers.getContractFactory("MstableYield");

        const configParams = config.mainnet;
        let mstableYield = await MstableYield.deploy(
            configParams.musdTokenAddress,
            configParams.mstableSavingContract,
            deployer.address, // false yolo address
        );
        await mstableYield.deployed();

        mstableYield = new ethers.Contract(
            mstableYield.address,
            MstableYieldArtifacts.abi,
            deployer
        );

        await mstableYield.maxApprove(usdcAddress);

        // Create USDC contract instance
        const usdcContract = new ethers.Contract(
            usdcAddress,
            IERC20Artifacts.abi,
            deployer
        );

        const amount = new BigNumber(1).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();

        await usdcContract.transfer(mstableYield.address, amount);
        await mstableYield.deposit(usdcAddress, amount);

        const iouTokenBalance = await mstableYield.getTotalUnderlying(usdcAddress);
        const outputAmount = new BigNumber(0.99).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();

        expect(Number(iouTokenBalance)).greaterThanOrEqual(Number(outputAmount));

        await mstableYield.withdraw(usdcAddress, outputAmount);

        const newIouTokenBalance = await mstableYield.getTotalUnderlying(usdcAddress);
        const remainingAmount = new BigNumber(0.01).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();
        expect(Number(newIouTokenBalance)).lessThanOrEqual(Number(remainingAmount));
    });

    it("Should work for mUSD token as input", async function () {
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xa23F54e0BB57a6114D831c080823F5Fe2616CF98"]
        });

        const deployer = await ethers.provider.getSigner(
            "0xa23F54e0BB57a6114D831c080823F5Fe2616CF98"
        );
        deployer.address = deployer._address;

        // Deploy Yolo Contract
        const Yolo = await ethers.getContractFactory("Yolo");

        let yolo = await upgrades.deployProxy(
            Yolo,
            [
                deployer.address,
                deployer.address,
                ZERO_ADDRESS,
            ]
        );

        const MstableYield = await ethers.getContractFactory("MstableYield");

        const configParams = config.mainnet;
        let mstableYield = await MstableYield.deploy(
            configParams.musdTokenAddress,
            configParams.mstableSavingContract,
            deployer.address, // false yolo address
        );
        await mstableYield.deployed();

        mstableYield = new ethers.Contract(
            mstableYield.address,
            MstableYieldArtifacts.abi,
            deployer
        );

        const musdContract = new ethers.Contract(
            musdAddress,
            IERC20Artifacts.abi,
            deployer
        );

        const amount = new BigNumber(1).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();

        await musdContract.transfer(mstableYield.address, amount);
        await mstableYield.deposit(musdAddress, amount);

        const iouTokenBalance = await mstableYield.getTotalUnderlying(musdAddress);
        const outputAmount = new BigNumber(1).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();

        expect(Number(iouTokenBalance)).greaterThanOrEqual(Number(outputAmount));

        await mstableYield.withdraw(musdAddress, outputAmount);
        expect(await mstableYield.getTotalUnderlying(musdAddress)).eq(0);
    });
});
