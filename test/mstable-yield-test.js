const { expect } = require("chai");
const { default: BigNumber } = require("bignumber.js");
const config = require("../config/index.json");
const {
    ZERO_ADDRESS,
    ZERO_BYTES32,
} = require("@openzeppelin/test-helpers/src/constants");

const MstableYieldArtifacts = require(
    "../artifacts/contracts/mocks/MockMstableYield.sol/MockMstableYield.json"
);
const IERC20Artifacts = require(
    "../artifacts/contracts/mocks/TestERC20.sol/TestERC20.json"
);
const usdcAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

describe("Mstable Yield Test", function () {
    it("Should Work", async function () {
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
                40, // 40 for 0.4 %
                ZERO_ADDRESS,
            ]
        );

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

        await usdcContract.approve(mstableYield.address, amount);

        await mstableYield.deposit(usdcAddress, amount);

        const iouTokenBalance = await mstableYield.getTotalUnderlying(usdcAddress);
        const outputAmount = new BigNumber(0.99).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();

        expect(Number(iouTokenBalance)).greaterThanOrEqual(Number(outputAmount));

        await mstableYield.withdraw(usdcAddress, outputAmount, 0, 0, ZERO_ADDRESS, ZERO_BYTES32);

        const newIouTokenBalance = await mstableYield.getTotalUnderlying(usdcAddress);
        const remainingAmount = new BigNumber(0.01).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();
        expect(Number(newIouTokenBalance)).lessThanOrEqual(Number(remainingAmount));
    });
});
