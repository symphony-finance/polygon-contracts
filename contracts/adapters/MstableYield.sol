// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

import "../interfaces/IYieldAdapter.sol";
import "../interfaces/IAaveToken.sol";
import "../interfaces/IAaveLendingPool.sol";
import "../interfaces/IAavePoolCore.sol";

contract MstableYield is IYieldAdapter {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    address symphony;
    ISavingsManager savingManager;

    modifier onlySymphony {
        require(
            msg.sender == symphony,
            "MstableYield: Only symphony contract can invoke this function"
        );
        _;
    }

    constructor(address _symphony, ISavingsManager _savingManager) {
        require(
            _symphony != address(0),
            "MstableYield: Symphony:: zero address"
        );
        require(
            address(_savingManager) != address(0),
            "MstableYield: SavingManager:: zero address"
        );

        symphony = _symphony;
        savingManager = _savingManager;
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
        address saveAddress = savingManager.savingsContracts(asset);

        // Deposit amount to saving pool
        ISaveContract(saveAddress).depositSavings(amount);
    }

    /**
     * @dev Used to withdraw tokens from available protocol
     * @param asset the address of underlying token
     * @param amount the amount of asset
     **/
    function withdraw(address asset, uint256 amount)
        external
        override
        onlySymphony
    {
        address saveAddress = savingManager.savingsContracts(asset);
        ISaveContract(saveAddress).redeem(amount);
    }

    /**
     * @dev Used to get amount of underlying tokens
     * @param asset the address of asset
     * @return amount amount of underlying tokens
     **/
    function getTokensForShares(address asset)
        external
        view
        override
        returns (uint256 amount)
    {
        address saveAddress = savingManager.savingsContracts(asset);
        amount = ISaveContract(saveAddress).balanceOfUnderlying(symphony);
    }

    /**
     * @dev Used to get IOU token address
     * @param asset the address of token
     * @return iouToken address of IOU token
     **/
    function getYieldTokenAddress(address asset)
        external
        view
        override
        returns (address iouToken)
    {
        address saveAddress = savingManager.savingsContracts(asset);
        iouToken = ISaveContract(saveAddress).underlying();
    }

    /**
     * @dev Used to approve max token from yield provider contract
     * @param asset the address of token
     **/
    function maxApprove(address asset) external override {
        address saveAddress = savingManager.savingsContracts(asset);
        IERC20(asset).safeApprove(saveAddress, uint256(-1));
    }
}

interface ISaveContract {
    /** @dev Saver privs */
    function depositSavings(uint256 _amount)
        external
        returns (uint256 creditsIssued);

    function redeem(uint256 _amount) external returns (uint256 massetReturned);

    /** @dev Getters */
    function underlying() external view returns (address);

    function balanceOfUnderlying(address _user)
        external
        view
        returns (uint256 balance);
}

interface ISavingsManager {
    function savingsContracts(address) external view returns (address);
}
