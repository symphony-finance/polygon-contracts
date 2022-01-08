const hre = require("hardhat");
const { expect } = require("chai")

const config = require("../config/index.json");
const { default: BigNumber } = require("bignumber.js");
const { time } = require("@openzeppelin/test-helpers");
const IERC20Artifacts = require(
    "../artifacts/contracts/mocks/TestERC20.sol/TestERC20.json"
);
const YoloArtifacts = require(
    "../artifacts/contracts/Yolo.sol/Yolo.json"
);
const AaveYieldArtifacts = require(
    "../artifacts/contracts/adapters/AaveYield.sol/AaveYield.json"
);
const ChainlinkArtifacts = require(
    "../artifacts/contracts/oracles/ChainlinkOracle.sol/ChainlinkOracle.json"
);

const executorFeePercent = 12; // 0.12%
const protocolFeePercent = 8; // 0.08%
const daiAddress = "0x6b175474e89094c44da98b954eedeac495271d0f";
const usdcAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const recipient = "0x641fb9877b73823f41f0f25de666275e6e846e75";
const executor = "0xAb7677859331f95F25A3e7799176f7239feb5C44";

let inputAmount = new BigNumber(10)
    .times(new BigNumber(10).exponentiatedBy(new BigNumber(18)));
let executionFee = inputAmount
    .multipliedBy(new BigNumber(executorFeePercent / 100)).toString()
inputAmount = new BigNumber(inputAmount)
    .plus(new BigNumber(executionFee)).toString()

const minReturnAmount = new BigNumber(15).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(6))
).toString();

const stoplossAmount = new BigNumber(9.99).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(6))
).toString();

const approveAmount = new BigNumber(100)
    .times(
        new BigNumber(10)
            .exponentiatedBy(new BigNumber(18))
    )
    .toString();

describe("Fill Order Test", () => {
    it("Should fill order with own liquidity", async () => {
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
        });

        const deployer = await ethers.provider.getSigner(
            "0xAb7677859331f95F25A3e7799176f7239feb5C44"
        );
        deployer.address = deployer._address;

        let configParams = config.mainnet;

        // Create DAI contract instance
        const daiContract = new ethers.Contract(
            daiAddress,
            IERC20Artifacts.abi,
            deployer
        );

        // Deploy Chainlink Oracle
        const ChainlinkOracle = await hre.ethers.getContractFactory("ChainlinkOracle");
        let chainlinkOracle = await ChainlinkOracle.deploy(deployer.address);

        await chainlinkOracle.deployed();

        chainlinkOracle = new ethers.Contract(
            chainlinkOracle.address,
            ChainlinkArtifacts.abi,
            deployer
        );
        await chainlinkOracle.updateTokenFeeds(
            [usdcAddress],
            ["0x986b5E1e1755e3C2440e960477f25201B0a8bbD4"], // USDC-ETH
        );
        await chainlinkOracle.updateTokenFeeds(
            [daiAddress],
            ["0x773616E4d11A78F511299002da57A0a94577F1f4"], // DAI-ETH
        );

        await chainlinkOracle.updatePriceSlippage(100);

        // Deploy Yolo Contract
        const Yolo = await ethers.getContractFactory("Yolo");

        let yolo = await upgrades.deployProxy(
            Yolo,
            [
                deployer.address,
                deployer.address,
                chainlinkOracle.address
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
        await yolo.updateProtocolFee(protocolFeePercent);

        // Deploy AaveYield Contract
        const AaveYield = await hre.ethers.getContractFactory("AaveYield");

        let aaveYield = await AaveYield.deploy(
            yolo.address,
            deployer.address,
            daiAddress,
            configParams.aaveLendingPool,
            configParams.aaveIncentivesController
        );

        await aaveYield.deployed();

        aaveYield = new ethers.Contract(
            aaveYield.address,
            AaveYieldArtifacts.abi,
            deployer
        );

        await yolo.setStrategy(daiAddress, aaveYield.address);
        await yolo.updateTokenBuffer(daiAddress, 4000);
        await yolo.addWhitelistToken(daiAddress);

        await daiContract.approve(yolo.address, approveAmount);

        // Create Order
        const tx = await yolo.createOrder(
            recipient,
            daiAddress,
            usdcAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount,
            executor,
            executionFee,
        );

        const receipt = await tx.wait();
        const events = receipt.events.filter((x) => { return x.event == "OrderCreated" });

        const orderId = events[0].args[0];
        const orderData = events[0].args[1];

        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
        });

        const newDeployer = await ethers.provider.getSigner(
            "0xAb7677859331f95F25A3e7799176f7239feb5C44"
        );

        // Create USDC contract instance
        const usdcContract = new ethers.Contract(
            usdcAddress,
            IERC20Artifacts.abi,
            newDeployer
        );

        await usdcContract.approve(yolo.address, approveAmount);

        const execBalBeforeExecute = await daiContract.balanceOf(executor);
        const recDaiBalBeforeExecute = await daiContract.balanceOf(recipient);
        const recUsdcBalBeforeExecute = await usdcContract.balanceOf(recipient);

        yolo = new ethers.Contract(
            yolo.address,
            YoloArtifacts.abi,
            newDeployer
        );

        const quoteAmount = new BigNumber(16).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();

        // Advancing 100 blocks
        for (let i = 0; i < 100; ++i) {
            await time.advanceBlock();
        };

        const contractBal = await daiContract.balanceOf(yolo.address);
        const totalTokens = await yolo.callStatic.getTotalTokens(
            daiAddress, contractBal, aaveYield.address
        );
        const depositPlusYield = totalTokens; // as there is only one order
        const yieldEarned = new BigNumber(depositPlusYield.toString())
            .minus(new BigNumber(inputAmount));

        // Execute Order
        await yolo.fillOrder(orderId, orderData, quoteAmount);

        const execBalAfterExecute = await daiContract.balanceOf(executor);
        const recDaiBalAfterExecute = await daiContract.balanceOf(recipient);
        const recUsdcBalAfterExecute = await usdcContract.balanceOf(recipient);
        const treasuryBalAfter = await daiContract.balanceOf(treasury.address);

        const protocolFee = getProtocolFee(inputAmount);

        expect(Number(execBalAfterExecute))
            .to.be.greaterThanOrEqual(
                Number(
                    new BigNumber(execBalBeforeExecute.toString())
                        .plus(new BigNumber(inputAmount))
                        .minus(protocolFee)
                )
            );

        expect(Number(recDaiBalAfterExecute)).to.be
            .greaterThanOrEqual(
                Number(
                    new BigNumber(
                        recDaiBalBeforeExecute.toString()
                    ).plus(yieldEarned)
                ));

        expect(Number(recUsdcBalAfterExecute)).to.eq(
            Number(
                new BigNumber(
                    recUsdcBalBeforeExecute.toString()
                ).plus(quoteAmount)
            ));

        expect(Number(protocolFee)).to.be.eq(Number(treasuryBalAfter));
    });
});

const getProtocolFee = (inputAmount) => {
    const _protocolFeePercent = new BigNumber(protocolFeePercent / 100);
    return new BigNumber(inputAmount).multipliedBy(_protocolFeePercent).dividedBy(100);
}
