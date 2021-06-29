const { expect } = require("chai");
const { default: BigNumber } = require("bignumber.js");
const IERC20Artifacts = require(
    "../artifacts/contracts/mocks/TestERC20.sol/TestERC20.json"
);
const SymphonyArtifacts = require(
    "../artifacts/contracts/Symphony.sol/Symphony.json"
);

const daiAddress = "0x6b175474e89094c44da98b954eedeac495271d0f";
const usdcAddress = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";

describe("Create Order Test", function () {
    it("Should create order", async function () {
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
                1,
                // 3000
            ]
        );

        await symphony.deployed();
        console.log("Symphony contract deployed to:", symphony.address, "\n");

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

        await daiContract.approve(symphony.address, approveAmount);
        await usdcContract.approve(symphony.address, approveAmount);

        expect(await symphony.totalAssetShares(daiAddress)).to.eq(0);

        const inputAmount = new BigNumber(10).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(18))
        ).toString();

        const minReturnAmount = new BigNumber(15).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();

        const stoplossAmount = new BigNumber(8).times(
            new BigNumber(10).exponentiatedBy(new BigNumber(6))
        ).toString();

        // Create Order
        const tx = await symphony.createOrder(
            deployer.address,
            daiAddress,
            usdcAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount
        );

        const receipt = await tx.wait();
        const events = receipt.events.filter((x) => { return x.event == "OrderCreated" });

        const orderId = events[0].args[0];
        const orderData = events[0].args[1];

        const _orderId = await symphony.getOrderId(
            deployer.address,
            daiAddress,
            usdcAddress,
            inputAmount,
            minReturnAmount,
            stoplossAmount
        );

        expect(orderId).to.eq(_orderId);

        expect(await symphony.totalAssetShares(daiAddress)).to.eq(inputAmount);

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

        expect(decodedData[0].toLowerCase()).to.eq(deployer.address.toLowerCase());
        expect(decodedData[1].toLowerCase()).to.eq(daiAddress.toLowerCase());
        expect(decodedData[2].toLowerCase()).to.eq(usdcAddress.toLowerCase());
        expect(decodedData[3]).to.eq(inputAmount);
        expect(decodedData[4]).to.eq(minReturnAmount);
        expect(decodedData[5]).to.eq(stoplossAmount);
        expect(decodedData[6]).to.eq(inputAmount);

        await expect(
            symphony.createOrder(
                deployer.address,
                daiAddress,
                usdcAddress,
                inputAmount,
                minReturnAmount,
                stoplossAmount
            )
        ).to.be.revertedWith(
            'Symphony: depositToken:: There is already an existing order with same key'
        );

        // Create New Order
        const newstoploss =
            new BigNumber(7).times(
                new BigNumber(10).exponentiatedBy(new BigNumber(6))
            ).toString();

        await symphony.createOrder(
            deployer.address,
            daiAddress,
            usdcAddress,
            inputAmount,
            minReturnAmount,
            newstoploss
        );

        expect(await symphony.totalAssetShares(daiAddress)).to.eq(
            new BigNumber(2).times(new BigNumber(inputAmount)).toString()
        );
    });
});
