// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;

import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";
import "hardhat/console.sol";

import "../interfaces/IERC20WithDecimal.sol";
import "../interfaces/ImAsset.sol";
import "../interfaces/IYieldAdapter.sol";
import "../interfaces/ISavingsContract.sol";

contract MockMstableYield is Initializable {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    address public immutable musdToken;
    address public immutable symphony;
    ISavingsContract public immutable savingContract;

    modifier onlySymphony() {
        require(
            msg.sender == symphony,
            "MstableYield: Only symphony contract can invoke this function"
        );
        _;
    }

    /**
     * @dev To initialize the contract addresses interacting with this contract
     * @param _musdToken the address of mUSD token
     * @param _savingContract the address of mstable saving manager
     * @param _symphony the address of the symphony smart contract
     **/
    constructor(
        address _musdToken,
        ISavingsContract _savingContract,
        address _symphony
    ) {
        require(
            _symphony != address(0),
            "MstableYield: Symphony:: zero address"
        );
        require(
            address(_musdToken) != address(0),
            "MstableYield: MUSD Token: zero address"
        );
        require(
            address(_savingContract) != address(0),
            "MstableYield: SavingContract:: zero address"
        );

        musdToken = _musdToken;
        symphony = _symphony;
        savingContract = _savingContract;
        IERC20(_musdToken).safeApprove(address(_savingContract), uint256(-1));
    }

    /**
     * @dev Used to deposit tokens in available protocol
     * @param asset the address of token to invest
     * @param amount the amount of asset
     **/
    function deposit(address asset, uint256 amount) external {
        require(amount != 0, "MstableYield: zero amount");

        // transfer token from symphony
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);

        if (asset != musdToken) {
            // get minimum musd token to mint
            uint256 minOutput = ImAsset(musdToken).getMintOutput(asset, amount);
            console.log("minOutput %s tokens", minOutput);

            // mint mUSD from base asset
            amount = ImAsset(musdToken).mint(
                asset,
                amount,
                minOutput,
                address(this)
            );
        }

        uint256 balance = IERC20(musdToken).balanceOf(address(this));
        console.log("after %s tokens", balance);

        // Deposit amount to saving pool
        savingContract.depositSavings(amount);
    }

    /**
     * @dev Used to withdraw tokens from available protocol
     * @param asset the address of underlying token
     * @param amount the amount of asset
     **/
    function withdraw(
        address asset,
        uint256 amount,
        uint256,
        uint256,
        address,
        bytes32
    ) external {
        _withdraw(asset, amount, msg.sender);
    }

    /**
     * @dev Withdraw all tokens from the strategy
     * @param asset the address of token
     **/
    function withdrawAll(address asset, bytes calldata) external {
        uint256 amount = savingContract.balanceOfUnderlying(symphony);
        _withdraw(asset, amount, msg.sender);
    }

    /**
     * @dev Used to approve max token from yield provider contract
     * @param asset the address of token
     **/
    function maxApprove(address asset) external {
        IERC20(asset).safeApprove(address(musdToken), uint256(-1));
    }

    /**
     * @dev Used to get amount of underlying tokens
     * @return amount amount of underlying tokens
     **/
    function getTotalUnderlying(address asset)
        public
        view
        returns (uint256 amount)
    {
        amount = savingContract.balanceOfUnderlying(address(this));

        uint8 decimal = IERC20WithDecimal(asset).decimals();
        if (decimal < 18) {
            amount = amount.div(10**(18 - decimal));
        }
    }

    /**
     * @dev Used to get IOU token address
     * @return iouToken address of IOU token
     **/
    function getYieldTokenAddress(address)
        public
        view
        returns (address iouToken)
    {
        iouToken = savingContract.underlying();
    }

    function setOrderRewardDebt(
        bytes32,
        address,
        uint256,
        uint256
    ) external {}

    function _withdraw(
        address asset,
        uint256 amount,
        address recipient
    ) internal {
        uint8 decimal = IERC20WithDecimal(asset).decimals();
        if (decimal < 18) {
            amount = amount.mul(10**(18 - decimal));
        }
        console.log("total underlying %s", getTotalUnderlying(asset));
        console.log("amount %s tokens", amount);

        console.log(
            "musd before %s",
            IERC20(musdToken).balanceOf(address(this))
        );
        // redeem mUSD for imUSD (IOU)
        savingContract.redeemUnderlying(amount);
        console.log(
            "musd after %s",
            IERC20(musdToken).balanceOf(address(this))
        );
        if (asset != musdToken) {
            uint256 minOutputQuantity = ImAsset(musdToken).getRedeemOutput(
                asset,
                amount
            );

            console.log("minOutputQuantity %s tokens", minOutputQuantity);

            console.log("adhjwd %s", IERC20(asset).balanceOf(symphony));

            // redeem mUSD for base asset
            ImAsset(musdToken).redeem(
                asset,
                amount,
                minOutputQuantity,
                symphony
            );

            console.log("ewd %s", IERC20(asset).balanceOf(symphony));
        } else {
            IERC20(asset).safeTransfer(recipient, amount);
        }
    }
}
