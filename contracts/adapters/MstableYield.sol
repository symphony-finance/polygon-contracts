// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/IYieldAdapter.sol";
import "../interfaces/IDetailedERC20.sol";
import "../interfaces/mstable/ImAsset.sol";
import "../interfaces/mstable/ISavingsContract.sol";

contract MstableYield is IYieldAdapter {
    using SafeERC20 for IERC20;

    address public immutable yolo;
    address public immutable musdToken;
    ISavingsContract public immutable savingContract;

    modifier onlyYolo() {
        require(
            msg.sender == yolo,
            "MstableYield: Only yolo contract can invoke this function"
        );
        _;
    }

    /**
     * @dev To initialize the contract addresses interacting with this contract
     * @param _musdToken the address of mUSD token
     * @param _savingContract the address of mstable saving manager
     * @param _yolo the address of the yolo smart contract
     **/
    constructor(
        address _musdToken,
        ISavingsContract _savingContract,
        address _yolo
    ) {
        require(_yolo != address(0), "yolo: zero address");
        require(address(_musdToken) != address(0), "mUSD token: zero address");
        require(
            address(_savingContract) != address(0),
            "saving contract: zero address"
        );

        musdToken = _musdToken;
        yolo = _yolo;
        savingContract = _savingContract;
        IERC20(_musdToken).safeApprove(
            address(_savingContract),
            type(uint256).max
        );
    }

    /**
     * @dev Used to deposit tokens in available protocol
     **/
    function deposit(address token, uint256 amount) external override onlyYolo {
        require(amount != 0, "MstableYield: zero amount");

        if (token != musdToken) {
            // get minimum musd token to mint
            uint256 minOutput = ImAsset(musdToken).getMintOutput(token, amount);

            // mint mUSD from base token
            amount = ImAsset(musdToken).mint(
                token,
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
     **/
    function withdraw(address token, uint256 amount)
        external
        override
        onlyYolo
    {
        _withdraw(token, amount);
    }

    /**
     * @dev Withdraw all tokens from the strategy
     **/
    function withdrawAll(address token) external override onlyYolo {
        uint256 amount = savingContract.balanceOfUnderlying(yolo);
        _withdraw(token, amount);
    }

    /**
     * @dev Used to approve max token from yield provider contract
     **/
    function maxApprove(address token) external {
        IERC20(token).safeApprove(address(musdToken), 0);
        IERC20(token).safeApprove(address(musdToken), type(uint256).max);
    }

    /**
     * @dev Used to get amount of underlying tokens
     * @return amount amount of underlying tokens
     **/
    function getTotalUnderlying(address token)
        external
        view
        override
        returns (uint256 amount)
    {
        amount = savingContract.balanceOfUnderlying(address(this));

        uint8 decimal = IDetailedERC20(token).decimals();
        if (decimal < 18) {
            amount = amount / (10**(18 - decimal));
        }
    }

    /**
     * @dev Used to get IOU token address
     * @return iouToken address of IOU token
     **/
    function getIouTokenAddress(address)
        public
        view
        override
        returns (address iouToken)
    {
        iouToken = savingContract.underlying();
    }

    function _withdraw(address token, uint256 amount) internal {
        uint8 decimal = IDetailedERC20(token).decimals();
        if (decimal < 18) {
            amount = amount * (10**(18 - decimal));
        }

        // redeem mUSD for imUSD (IOU)
        savingContract.redeemUnderlying(amount);

        if (token != musdToken) {
            uint256 minOutputQuantity = ImAsset(musdToken).getRedeemOutput(
                token,
                amount
            );

            // redeem mUSD for base token
            ImAsset(musdToken).redeem(token, amount, minOutputQuantity, yolo);
        } else {
            IERC20(token).safeTransfer(yolo, amount);
        }
    }
}
