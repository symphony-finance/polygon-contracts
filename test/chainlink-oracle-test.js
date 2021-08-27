const hre = require("hardhat");
const { expect } = require("chai");
const { default: BigNumber } = require("bignumber.js");
const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants");
const ChainlinkArtifacts = require(
    "../artifacts/contracts/oracles/ChainlinkOracle.sol/ChainlinkOracle.json"
);

const daiAddress = "0x6b175474e89094c44da98b954eedeac495271d0f";
const usdcAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const aaveAddress = "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9";

const daiFeed = "0x773616E4d11A78F511299002da57A0a94577F1f4"
const usdcFeed = "0x986b5E1e1755e3C2440e960477f25201B0a8bbD4";
const aaveFeed = "0x6df09e975c830ecae5bd4ed9d90f3a95a4f88012";

describe("Chainlink Oracle Test", () => {
    it("should add oracle feed in the contract", async () => {
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
        });

        const deployer = await ethers.provider.getSigner(
            "0xAb7677859331f95F25A3e7799176f7239feb5C44"
        );
        deployer.address = deployer._address;

        // Deploy Chainlink Oracle
        const ChainlinkOracle = await hre.ethers.getContractFactory("ChainlinkOracle");
        let chainlinkOracle = await ChainlinkOracle.deploy(deployer.address);

        await chainlinkOracle.deployed();

        chainlinkOracle = new ethers.Contract(
            chainlinkOracle.address,
            ChainlinkArtifacts.abi,
            deployer
        );

        expect(await chainlinkOracle.owner()).to.eq(deployer.address);

        await chainlinkOracle.addTokenFeed(daiAddress, daiFeed);
        await chainlinkOracle.addTokenFeed(usdcAddress, usdcFeed);

        expect(await chainlinkOracle.oracleFeed(daiAddress)).to.eq(daiFeed);
        expect(await chainlinkOracle.oracleFeed(usdcAddress)).to.eq(usdcFeed);
    });

    it("should fetch the price of a pair", async () => {
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
        });

        const deployer = await ethers.provider.getSigner(
            "0xAb7677859331f95F25A3e7799176f7239feb5C44"
        );
        deployer.address = deployer._address;

        // Deploy Chainlink Oracle
        const ChainlinkOracle = await hre.ethers.getContractFactory("ChainlinkOracle");
        let chainlinkOracle = await ChainlinkOracle.deploy(deployer.address);

        await chainlinkOracle.deployed();

        chainlinkOracle = new ethers.Contract(
            chainlinkOracle.address,
            ChainlinkArtifacts.abi,
            deployer
        );

        await chainlinkOracle.addTokenFeed(daiAddress, daiFeed);
        await chainlinkOracle.addTokenFeed(usdcAddress, usdcFeed);
        await chainlinkOracle.addTokenFeed(aaveAddress, aaveFeed);

        await chainlinkOracle.updatePriceSlippage(0);

        // USDC to DAI price
        const inputAmount1 = new BigNumber(10).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();

        const outputAmount1 = new BigNumber(9.95).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(18))
        ).toString();

        expect(Number(await chainlinkOracle.get(
            usdcAddress, daiAddress, inputAmount1
        ))).to.be.greaterThan(Number(outputAmount1));

        // DAI to USDC price
        const inputAmount2 = new BigNumber(10).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(18))
        ).toString();

        const outputAmount2 = new BigNumber(9.95).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();

        expect(Number(await chainlinkOracle.get(
            daiAddress, usdcAddress, inputAmount2
        ))).to.be.greaterThan(Number(outputAmount2));

        // DAI to AAVE price
        const inputAmount3 = new BigNumber(100).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(18))
        ).toString();

        const outputAmount3 = new BigNumber(0.469).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(18))
        ).toString();

        expect(Number(await chainlinkOracle.get(
            daiAddress, aaveAddress, inputAmount3
        ))).to.be.greaterThan(Number(outputAmount3));
    });

    it("should revert if no price feed", async () => {
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: ["0xAb7677859331f95F25A3e7799176f7239feb5C44"]
        });

        const deployer = await ethers.provider.getSigner(
            "0xAb7677859331f95F25A3e7799176f7239feb5C44"
        );
        deployer.address = deployer._address;

        // Deploy Chainlink Oracle
        const ChainlinkOracle = await hre.ethers.getContractFactory("ChainlinkOracle");
        let chainlinkOracle = await ChainlinkOracle.deploy(deployer.address);

        await chainlinkOracle.deployed();

        chainlinkOracle = new ethers.Contract(
            chainlinkOracle.address,
            ChainlinkArtifacts.abi,
            deployer
        );

        await chainlinkOracle.addTokenFeed(daiAddress, daiFeed);

        // USDC to DAI price
        const inputAmount = new BigNumber(10).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();

        await expect(
            chainlinkOracle.get(
                usdcAddress, daiAddress, inputAmount
            )
        ).to.be.revertedWith(
            "Oracle feed doesn't exist for the input asset."
        );

        await chainlinkOracle.addTokenFeed(usdcAddress, usdcFeed);
        await chainlinkOracle.addTokenFeed(daiAddress, ZERO_ADDRESS);

        await expect(
            chainlinkOracle.get(
                usdcAddress, daiAddress, inputAmount
            )
        ).to.be.revertedWith(
            "Oracle feed doesn't exist for the output asset."
        );
    });
});
