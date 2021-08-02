const hre = require("hardhat");
const { expect } = require("chai");
const config = require("../config/index.json");
const { default: BigNumber } = require("bignumber.js");
const { time } = require("@openzeppelin/test-helpers");
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

describe("Migrate Strategt Test", function () {
    it("Should migrate strategy of asset", async function () {
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
                40
            ]
        );

        await symphony.deployed();
        console.log("Symphony contract deployed to:", symphony.address, "\n");

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
        console.log("AaveYield contract deployed to:", aaveYield.address, "\n");

        aaveYield = new ethers.Contract(
            aaveYield.address,
            AaveYieldArtifacts.abi,
            deployer
        );

        await symphony.updateStrategy(usdcAddress, aaveYield.address);
        await symphony.updateBufferPercentage(usdcAddress, 4000);

        const approveAmount = new BigNumber(100)
            .times(
                new BigNumber(10)
                    .exponentiatedBy(new BigNumber(18))
            )
            .toString();

        await daiContract.approve(symphony.address, approveAmount);
        await usdcContract.approve(symphony.address, approveAmount);

        const inputAmount = new BigNumber(10).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();

        const minReturnAmount = new BigNumber(15).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(18))
        ).toString();

        const stoplossAmount = new BigNumber(11).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(18))
        ).toString();

        // Create Order
        await symphony.createOrder(
            deployer.address,
            usdcAddress,
            daiAddress,
            1000000,
            minReturnAmount,
            stoplossAmount
        );

        console.log("Advancing 100 blocks..");
        for (let i = 0; i < 100; ++i) {
            await time.advanceBlock();
        };

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

        for (let i = 0; i < 100; ++i) {
            await time.advanceBlock();
        };

        const rewardBalance = await aaveYield.getRewardBalance(usdcAddress);

        // withdrawing reward from Aave
        await symphony.executeTransaction(
            configParams.aaveIncentivesController,
            0,
            'claimRewards(address[],uint256,address)',
            encodeParameters(
                ['address[]', 'uint256', 'address'],
                [
                    [await aaveYield.getYieldTokenAddress(usdcAddress)],
                    rewardBalance,
                    symphony.address
                ]
            ),
        );

        const rewardToken = "0x4da27a545c0c5b758a6ba100e3a049001de870f5";

        // Create USDC contract instance
        const rewardContract = new ethers.Contract(
            rewardToken,
            IERC20Artifacts.abi,
            deployer
        );

        expect(
            Number(await rewardContract.balanceOf(symphony.address))
        ).greaterThanOrEqual(Number(rewardBalance));

        // Deploy AaveYield Contract
        const AaveYieldNew = await hre.ethers.getContractFactory("AaveYield");

        let aaveYieldNew = await upgrades.deployProxy(
            AaveYieldNew,
            [
                symphony.address,
                configParams.mstableSavingManager,
            ]
        );

        await aaveYieldNew.deployed();
        console.log("AaveYield new contract deployed to:", aaveYieldNew.address, "\n");

        await symphony.migrateStrategy(usdcAddress, aaveYieldNew.address);

        expect(await symphony.strategy(usdcAddress)).to.eq(aaveYieldNew.address);

        await symphony.cancelOrder(orderId, orderData);
    });
});

function encodeParameters(types, values) {
    const abi = new ethers.utils.AbiCoder();
    return abi.encode(types, values);
}
