const hre = require("hardhat");
const { expect } = require("chai");
const config = require("../config/index.json");
const { default: BigNumber } = require("bignumber.js");
const IERC20Artifacts = require(
    "../artifacts/contracts/mocks/TestERC20.sol/TestERC20.json"
);
const BalancerArtifacts = require(
    "../artifacts/contracts/handlers/BalancerHandler.sol/BalancerHandler.json"
);
const ChainlinkArtifacts = require(
    "../artifacts/contracts/oracles/ChainlinkOracle.sol/ChainlinkOracle.json"
);
const { AbiCoder } = require("ethers/lib/utils");
const { expectRevert } = require("@openzeppelin/test-helpers");
const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants");

const daiAddress = "0x6b175474e89094c44da98b954eedeac495271d0f";
const usdcAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const balAddress = "0xba100000625a3754423978a60c9317c58a424e3D";

const daiUsdcPool = "0x148ce9b50be946a96e94a4f5479b771bab9b1c59000100000000000000000054";
const usdcBalPool = "0x9c08c7a7a89cfd671c79eacdc6f07c1996277ed5000200000000000000000025";

const configParams = config.mainnet;
const totalFeePercent = 40; // 0.4%;
const protocolFeePercent = 2500; // 0.1%
const recipient = "0xAb7677859331f95F25A3e7799176f7239feb5C44";
const executor = "0x86A2EE8FAf9A840F7a2c64CA3d51209F9A02081D";
const treasury = "0x49fd2BE640DB2910c2fAb69bB8531Ab6E76127ff";

const inputAmount = new BigNumber(1).times(
    new BigNumber(10).exponentiatedBy(new BigNumber(6))
).toString();

describe("Balancer Handler Test", () => {
    it("Should swap with no hop", async () => {
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

        // Deploy Chainlink Oracle
        const ChainlinkOracle = await hre.ethers.getContractFactory("ChainlinkOracle");
        let chainlinkOracle = await ChainlinkOracle.deploy(deployer.address);

        await chainlinkOracle.deployed();

        chainlinkOracle = new ethers.Contract(
            chainlinkOracle.address,
            ChainlinkArtifacts.abi,
            deployer
        );

        await chainlinkOracle.updateTokenFeed(
            usdcAddress,
            "0x986b5E1e1755e3C2440e960477f25201B0a8bbD4", // USDC-ETH
        );

        await chainlinkOracle.updateTokenFeed(
            balAddress,
            "0xC1438AA3823A6Ba0C159CfA8D98dF5A994bA120b", // BAL-ETH
        );

        // Deploy Balancer Handler
        const BalancerHandler = await ethers.getContractFactory("MockBalancerHandler");

        let balancerHandler = await BalancerHandler.deploy(
            configParams.balancerVault,
            ZERO_ADDRESS
        );

        await balancerHandler.deployed();

        balancerHandler = new ethers.Contract(
            balancerHandler.address,
            BalancerArtifacts.abi,
            deployer
        );

        await usdcContract.transfer(balancerHandler.address, inputAmount);

        const minReturnAmount = new BigNumber(0.05).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(18))
        ).toString();

        const order = {
            recipient,
            inputToken: usdcAddress,
            outputToken: balAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount: 0,
            shares: 0,
        };

        // Create Bal contract instance
        const balContract = new ethers.Contract(
            balAddress,
            IERC20Artifacts.abi,
            deployer
        );

        const recipientBalBefore = await balContract.balanceOf(recipient);
        const executorBalBefore = await balContract.balanceOf(executor);
        const treasuryBalBefore = await balContract.balanceOf(treasury);

        const oracleResult = await chainlinkOracle.get(
            order.inputToken,
            order.outputToken,
            order.inputAmount,
        );

        const addresses = [usdcAddress, balAddress];
        const swapSteps = [{
            poolId: usdcBalPool,
            assetInIndex: '0',
            assetOutIndex: '1',
            amount: order.inputAmount,
            userData: 0x0,
        }];
        const data = encodeData(addresses, swapSteps);

        await balancerHandler.handle(
            order,
            oracleResult.amountOutWithSlippage,
            totalFeePercent,
            protocolFeePercent,
            executor,
            treasury,
            data
        );

        const recipientBalAfter = await balContract.balanceOf(recipient);
        const executorBalAfter = await balContract.balanceOf(executor);
        const treasuryBalAfter = await balContract.balanceOf(treasury);

        const result = getParticipantsDividend(minReturnAmount);

        expect(Number(recipientBalAfter)).to.be.greaterThanOrEqual(
            Number(result.recipientAmount.plus(
                new BigNumber(recipientBalBefore.toString()))
            )
        );

        expect(Number(executorBalAfter)).to.be.greaterThanOrEqual(
            Number(result.executorFee.plus(
                new BigNumber(executorBalBefore.toString()))
            )
        );
        expect(Number(treasuryBalAfter)).to.be.greaterThanOrEqual(
            Number(result.protocolFee.plus(
                new BigNumber(treasuryBalBefore.toString()))
            )
        );
    });

    it("Should swap token with two hop", async () => {
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

        // Deploy Chainlink Oracle
        const ChainlinkOracle = await hre.ethers.getContractFactory("ChainlinkOracle");
        let chainlinkOracle = await ChainlinkOracle.deploy(deployer.address);

        await chainlinkOracle.deployed();

        chainlinkOracle = new ethers.Contract(
            chainlinkOracle.address,
            ChainlinkArtifacts.abi,
            deployer
        );
        await chainlinkOracle.updateTokenFeed(
            usdcAddress,
            "0x986b5E1e1755e3C2440e960477f25201B0a8bbD4", // USDC-ETH
        );

        await chainlinkOracle.updateTokenFeed(
            daiAddress,
            "0x773616E4d11A78F511299002da57A0a94577F1f4", // DAI-ETH
        );

        await chainlinkOracle.updatePriceSlippage(450);

        // Deploy Balancer Handler
        const BalancerHandler = await ethers.getContractFactory("MockBalancerHandler");

        let balancerHandler = await BalancerHandler.deploy(
            configParams.balancerVault,
            ZERO_ADDRESS
        );

        await balancerHandler.deployed();

        balancerHandler = new ethers.Contract(
            balancerHandler.address,
            BalancerArtifacts.abi,
            deployer
        );

        await usdcContract.transfer(balancerHandler.address, inputAmount);

        const minReturnAmount = new BigNumber(1.05).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(18))
        ).toString();

        const stoplossAmount = new BigNumber(0.98).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(18))
        ).toString();

        // Create DAI contract instance
        const daiContract = new ethers.Contract(
            daiAddress,
            IERC20Artifacts.abi,
            deployer
        );

        const recipientBalBefore = await daiContract.balanceOf(recipient);
        const executorBalBefore = await daiContract.balanceOf(executor);
        const treasuryBalBefore = await daiContract.balanceOf(treasury);

        const order = {
            recipient,
            inputToken: usdcAddress,
            outputToken: daiAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount,
            shares: 0,
        };

        const oracleResult = await chainlinkOracle.get(
            order.inputToken,
            order.outputToken,
            order.inputAmount,
        );

        const addresses = [usdcAddress, balAddress, daiAddress];
        const swapSteps = [{
            poolId: usdcBalPool,
            assetInIndex: '0',
            assetOutIndex: '1',
            amount: order.inputAmount,
            userData: 0x0,
        }, {
            poolId: daiUsdcPool,
            assetInIndex: '1',
            assetOutIndex: '2',
            amount: 0,
            userData: 0x0,
        }];
        const data = encodeData(addresses, swapSteps);

        await balancerHandler.handle(
            order,
            oracleResult.amountOutWithSlippage,
            totalFeePercent,
            protocolFeePercent,
            executor,
            treasury,
            data
        );

        const recipientBalAfter = await daiContract.balanceOf(recipient);
        const executorBalAfter = await daiContract.balanceOf(executor);
        const treasuryBalAfter = await daiContract.balanceOf(treasury);

        const result = getParticipantsDividend(stoplossAmount);

        expect(Number(recipientBalAfter)).to.be
            .greaterThan(Number(recipientBalBefore));

        expect(Number(recipientBalAfter)).to.be.lessThan(
            Number(result.recipientAmount.plus(
                new BigNumber(recipientBalBefore.toString()))
            )
        );

        expect(Number(recipientBalAfter)).to.be
            .greaterThan(Number(recipientBalBefore));

        expect(Number(executorBalAfter)).to.be.lessThan(
            Number(result.executorFee.plus(
                new BigNumber(executorBalBefore.toString()))
            )
        );

        expect(Number(recipientBalAfter)).to.be
            .greaterThan(Number(recipientBalBefore));

        expect(Number(treasuryBalAfter)).to.be.lessThan(
            Number(result.protocolFee.plus(
                new BigNumber(treasuryBalBefore.toString()))
            )
        );
    });

    it("Should revert if incorrect output token passed", async () => {
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

        // Deploy Balancer Handler
        const BalancerHandler = await ethers.getContractFactory("MockBalancerHandler");

        let balancerHandler = await BalancerHandler.deploy(
            configParams.balancerVault,
            ZERO_ADDRESS
        );

        await balancerHandler.deployed();

        balancerHandler = new ethers.Contract(
            balancerHandler.address,
            BalancerArtifacts.abi,
            deployer
        );

        await usdcContract.transfer(balancerHandler.address, inputAmount);

        const minReturnAmount = new BigNumber(1.05).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(18))
        ).toString();

        const stoplossAmount = new BigNumber(0.98).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(18))
        ).toString();

        const order = {
            recipient,
            inputToken: usdcAddress,
            outputToken: daiAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount,
            shares: 0,
        };

        const addresses = [usdcAddress, balAddress];
        const swapSteps = [{
            poolId: usdcBalPool,
            assetInIndex: '0',
            assetOutIndex: '1',
            amount: order.inputAmount,
            userData: 0x0,
        }];
        const data = encodeData(addresses, swapSteps);

        await expectRevert(
            balancerHandler.handle(
                order,
                order.minReturnAmount + 1, // false oracle amount
                totalFeePercent,
                protocolFeePercent,
                executor,
                treasury,
                data
            ),
            "BalancerHandler: Incorrect output token recieved !!"
        )
    });

    it("Should revert if input or output amount changed in handler data", async () => {
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

        // Deploy Chainlink Oracle
        const ChainlinkOracle = await hre.ethers.getContractFactory("ChainlinkOracle");
        let chainlinkOracle = await ChainlinkOracle.deploy(deployer.address);

        await chainlinkOracle.deployed();

        chainlinkOracle = new ethers.Contract(
            chainlinkOracle.address,
            ChainlinkArtifacts.abi,
            deployer
        );

        await chainlinkOracle.updateTokenFeed(
            usdcAddress,
            "0x986b5E1e1755e3C2440e960477f25201B0a8bbD4", // USDC-ETH
        );

        await chainlinkOracle.updateTokenFeed(
            daiAddress,
            "0x773616E4d11A78F511299002da57A0a94577F1f4", // DAI-ETH
        );

        await chainlinkOracle.updatePriceSlippage(450);

        // Deploy Balancer Handler
        const BalancerHandler = await ethers.getContractFactory("MockBalancerHandler");

        let balancerHandler = await BalancerHandler.deploy(
            configParams.balancerVault,
            ZERO_ADDRESS
        );

        await balancerHandler.deployed();

        balancerHandler = new ethers.Contract(
            balancerHandler.address,
            BalancerArtifacts.abi,
            deployer
        );

        await usdcContract.transfer(balancerHandler.address, inputAmount);

        const minReturnAmount = new BigNumber(1.05).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(18))
        ).toString();

        const stoplossAmount = new BigNumber(0.98).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(18))
        ).toString();

        const order = {
            recipient,
            inputToken: usdcAddress,
            outputToken: daiAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount,
            shares: 0,
        };

        const oracleResult = await chainlinkOracle.get(
            order.inputToken,
            order.outputToken,
            order.inputAmount,
        );

        const addresses = [usdcAddress, balAddress, daiAddress];

        const decreasedInputAmt = new BigNumber(0.5).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();

        const swapSteps1 = [{
            poolId: usdcBalPool,
            assetInIndex: '0',
            assetOutIndex: '1',
            amount: decreasedInputAmt,
            userData: 0x0,
        }, {
            poolId: daiUsdcPool,
            assetInIndex: '1',
            assetOutIndex: '2',
            amount: 0,
            userData: 0x0,
        }];
        const data1 = encodeData(addresses, swapSteps1);

        await expectRevert(
            balancerHandler.handle(
                order,
                oracleResult.amountOutWithSlippage,
                totalFeePercent,
                protocolFeePercent,
                executor,
                treasury,
                data1
            ),
            "BalancerHandler: Oracle amount doesn't match with return amount !!"
        );

        const increasedInputAmt = new BigNumber(1.5).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();

        const swapSteps2 = [{
            poolId: usdcBalPool,
            assetInIndex: '0',
            assetOutIndex: '1',
            amount: increasedInputAmt,
            userData: 0x0,
        }, {
            poolId: daiUsdcPool,
            assetInIndex: '1',
            assetOutIndex: '2',
            amount: 0,
            userData: 0x0,
        }];
        const data2 = encodeData(addresses, swapSteps2);

        await expectRevert(
            balancerHandler.handle(
                order,
                oracleResult.amountOutWithSlippage,
                totalFeePercent,
                protocolFeePercent,
                executor,
                treasury,
                data2
            ),
            "ERC20: transfer amount exceeds allowance"
        );

        const swapSteps3 = [{
            poolId: usdcBalPool,
            assetInIndex: '0',
            assetOutIndex: '1',
            amount: order.inputAmount,
            userData: 0x0,
        }, {
            poolId: daiUsdcPool,
            assetInIndex: '1',
            assetOutIndex: '2',
            amount: 238,
            userData: 0x0,
        }];
        const data3 = encodeData(addresses, swapSteps3);

        await expectRevert(
            balancerHandler.handle(
                order,
                oracleResult.amountOutWithSlippage,
                totalFeePercent,
                protocolFeePercent,
                executor,
                treasury,
                data3
            ),
            "BalancerHandler: Oracle amount doesn't match with return amount !!"
        );
    });
});

const encodeData = (addresses, swapSteps) => {
    const abiCoder = new AbiCoder();

    return abiCoder.encode(
        [
            'address[]',
            "tuple(bytes32 poolId, uint256 assetInIndex, uint256 assetOutIndex, uint256 amount, bytes userData)[]"
        ],
        [addresses, swapSteps]
    )
}

const getParticipantsDividend = (amount) => {
    const _totalFeePercent = new BigNumber(totalFeePercent / 100);

    const _protocolFeePercent = _totalFeePercent.times(
        protocolFeePercent / 10000
    );
    const _executorFeePercent = _totalFeePercent.minus(
        _protocolFeePercent
    );

    const recipientAmount = new BigNumber(amount)
        .times(100 - _totalFeePercent).dividedBy(100);
    const executorFee = new BigNumber(amount)
        .times(_executorFeePercent).dividedBy(100);
    const protocolFee = new BigNumber(amount)
        .times(_protocolFeePercent).dividedBy(100);

    return { recipientAmount, executorFee, protocolFee };
}
