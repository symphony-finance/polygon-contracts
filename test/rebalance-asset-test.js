const { expect } = require("chai");
const config = require("../config/index.json");
const { default: BigNumber } = require("bignumber.js");
const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants");

const IERC20Artifacts = require(
    "../artifacts/contracts/mocks/TestERC20.sol/TestERC20.json"
);
const SymphonyArtifacts = require(
    "../artifacts/contracts/Symphony.sol/Symphony.json"
);

const daiAddress = "0x6b175474e89094c44da98b954eedeac495271d0f";
const baseFeeInPercent = 40; // 0.04%
const bufferPercent = 4000; // 30%

const depositAmount = (
    new BigNumber(10).
        times(
            new BigNumber(10)
                .exponentiatedBy(new BigNumber(18))
        )).toString();

describe("Rebalance Asset Test", () => {
    it("Should rebalance correctly", async () => {
        await hre.network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
        });

        const deployer = await ethers.provider.getSigner(
            "0xAb7677859331f95F25A3e7799176f7239feb5C44"
        );
        deployer.address = deployer._address;

        // Create DAI contract instance
        const daiContract = new ethers.Contract(
            daiAddress,
            IERC20Artifacts.abi,
            deployer
        );

        // Deploy Symphony Contract
        const Symphony = await ethers.getContractFactory("Symphony");

        symphony = await upgrades.deployProxy(
            Symphony,
            [
                deployer.address,
                deployer.address,
                baseFeeInPercent,
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

        await symphony.updateStrategy(daiAddress, aaveYield.address);
        expect(await symphony.strategy(daiAddress)).to.eq(aaveYield.address);

        await symphony.updateBufferPercentage(daiAddress, 4000);
        expect(await symphony.assetBuffer(daiAddress)).to.eq(4000);

        const aDAIAddress = await aaveYield.getYieldTokenAddress(daiAddress);

        // Create aDAI contract instance
        const adaiContract = new ethers.Contract(
            aDAIAddress,
            IERC20Artifacts.abi,
            deployer
        );

        expect(await daiContract.balanceOf(symphony.address)).to.eq(0);

        // Transfer Token
        await daiContract.transfer(symphony.address, depositAmount);

        expect(await daiContract.balanceOf(symphony.address)).to.eq(depositAmount);

        // Rebalance asset
        await symphony.rebalanceAsset(daiAddress);

        const bufferBalance = getBufferBalance(depositAmount, bufferPercent);
        const yieldBalance = getYieldBalance(depositAmount, bufferBalance);

        expect(await daiContract.balanceOf(symphony.address)).to.eq(bufferBalance);
        expect(
            Number(await adaiContract.balanceOf(aaveYield.address))
        ).to.greaterThanOrEqual(Number(yieldBalance));

        const depositAmountNew = (
            new BigNumber(0.1).
                times(
                    new BigNumber(10)
                        .exponentiatedBy(new BigNumber(18))
                )).toString();

        await daiContract.transfer(symphony.address, depositAmountNew);

        // Rebalance asset
        await symphony.rebalanceAsset(daiAddress);

        const bufferBalanceNew = getBufferBalance(
            new BigNumber(depositAmount).plus(depositAmountNew),
            bufferPercent
        );

        expect(
            Number(await daiContract.balanceOf(symphony.address))
        ).to.greaterThanOrEqual(Number(bufferBalanceNew));

        // Decrease buffer percent
        const newBufferPercent = 3000;
        await symphony.updateBufferPercentage(daiAddress, newBufferPercent);
        expect(await symphony.assetBuffer(daiAddress)).to.eq(newBufferPercent);

        await symphony.rebalanceAsset(daiAddress);

        const updatedBufferBalance = getBufferBalance(
            new BigNumber(depositAmount).plus(depositAmountNew),
            newBufferPercent,
        );

        const contractBufferBalance = Number(
            await daiContract.balanceOf(symphony.address)
        );

        expect(
            contractBufferBalance
        ).to.greaterThanOrEqual(Number(updatedBufferBalance));

        expect(contractBufferBalance).to.lessThan(Number(bufferBalanceNew));
    });

    it("Should revert for no strategy", async () => {
        await hre.network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
        });

        const deployer = await ethers.provider.getSigner(
            "0xAb7677859331f95F25A3e7799176f7239feb5C44"
        );
        deployer.address = deployer._address;

        // Deploy Symphony Contract
        const Symphony = await ethers.getContractFactory("Symphony");

        symphony = await upgrades.deployProxy(
            Symphony,
            [
                deployer.address,
                deployer.address,
                baseFeeInPercent,
                ZERO_ADDRESS,
            ]
        );

        await symphony.deployed();

        symphony = new ethers.Contract(
            symphony.address,
            SymphonyArtifacts.abi,
            deployer
        );

        await expect(
            symphony.rebalanceAsset(daiAddress)
        ).to.be.revertedWith(
            'Symphony::rebalanceAsset: Rebalance needs some strategy'
        );
    });
});

const getBufferBalance = (_amount, _bufferPercent) => {
    return (
        new BigNumber(_amount).dividedBy(
            new BigNumber(100)
        )
    ).times(
        new BigNumber(_bufferPercent).dividedBy(
            new BigNumber(100)
        )
    ).toString();
};

const getYieldBalance = (depositAmount, bufferAmount) => {
    return (
        new BigNumber(depositAmount).minus(
            new BigNumber(bufferAmount)
        )
    ).toString();
};
