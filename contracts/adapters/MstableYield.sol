// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";

import "../interfaces/ImAsset.sol";
import "../interfaces/IYieldAdapter.sol";
import "../interfaces/ISavingsContract.sol";
import "../interfaces/IERC20WithDecimal.sol";

contract MstableYield is IYieldAdapter, Initializable {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    address public musdToken;
    address public symphony;
    ISavingsContract public savingContract;

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
    function initialize(
        address _musdToken,
        ISavingsContract _savingContract,
        address _symphony
    ) external initializer {
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
        IERC20(musdToken).safeApprove(address(_savingContract), uint256(-1));
    }

    /**
     * @dev Used to deposit tokens in available protocol
     * @param asset the address of token to invest
     * @param amount the amount of asset
     **/
    function deposit(address asset, uint256 amount)
        external
        override
        onlySymphony
    {
        require(amount != 0, "MstableYield: zero amount");

        emit Deposit(asset, amount);

        // transfer token from symphony
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);

        if (asset != musdToken) {
            // get minimum musd token to mint
            uint256 minOutput = ImAsset(musdToken).getMintOutput(asset, amount);

            // mint mUSD from base asset
            amount = ImAsset(musdToken).mint(
                asset,
                amount,
                minOutput,
                address(this)
            );
        }

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
    ) external override onlySymphony {
        emit Withdraw(asset, amount);
        _withdraw(asset, amount);
    }

    /**
     * @dev Withdraw all tokens from the strategy
     * @param asset the address of token
     **/
    function withdrawAll(address asset, bytes calldata)
        external
        override
        onlySymphony
    {
        uint256 amount = savingContract.balanceOfUnderlying(symphony);
        emit Withdraw(asset, amount);
        _withdraw(asset, amount);
    }

    /**
     * @dev Used to approve max token from yield provider contract
     * @param asset the address of token
     **/
    function maxApprove(address asset) external override {
        IERC20(asset).safeApprove(address(musdToken), uint256(-1));
    }

    /**
     * @dev Used to get amount of underlying tokens
     * @return amount amount of underlying tokens
     **/
    function getTotalUnderlying(address asset)
        external
        view
        override
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
        override
        returns (address iouToken)
    {
        iouToken = savingContract.underlying();
    }

    function setOrderRewardDebt(
        bytes32,
        address,
        uint256,
        uint256
    ) external override {}

    function _withdraw(address asset, uint256 amount) internal {
        uint8 decimal = IERC20WithDecimal(asset).decimals();
        if (decimal < 18) {
            amount = amount.mul(10**(18 - decimal));
        }

        // redeem mUSD for imUSD (IOU)
        uint256 mAssetQuantity = savingContract.redeemUnderlying(amount);

        if (asset != musdToken) {
            uint256 minOutputQuantity = ImAsset(musdToken).getRedeemOutput(
                asset,
                amount
            );

            // redeem mUSD for base asset
            ImAsset(musdToken).redeem(
                asset,
                amount,
                minOutputQuantity,
                symphony
            );
        } else {
            IERC20(asset).safeTransfer(symphony, mAssetQuantity);
        }
    }
}
