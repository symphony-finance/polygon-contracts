// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-upgradeable/proxy/Initializable.sol";

import "../interfaces/IYieldAdapter.sol";
import "../interfaces/IAaveToken.sol";
import "../interfaces/IAaveLendingPool.sol";
import "../interfaces/IAavePoolCore.sol";

contract MstableYield is IYieldAdapter, Initializable {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    IERC20 public musdToken;
    address public symphony;
    ISavingsManager public savingManager;

    modifier onlySymphony() {
        require(
            msg.sender == symphony,
            "MstableYield: Only symphony contract can invoke this function"
        );
        _;
    }

    /**
     * @dev To initialize the contract addresses interacting with this contract
     * @param _savingManager the address of mstable saving manager
     * @param _symphony the address of the symphony smart contract
     **/
    function initialize(
        ISavingsManager _savingManager,
        IERC20 _musdToken,
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
            address(_savingManager) != address(0),
            "MstableYield: SavingManager:: zero address"
        );

        musdToken = _musdToken;
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
        require(amount != 0, "MstableYield: zero amount");

        emit Deposit(asset, amount);

        address saveAddress = savingManager.savingsContracts(asset);

        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);

        // Deposit amount to saving pool
        ISaveContract(saveAddress).depositSavings(amount, symphony);
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
        address saveAddress = savingManager.savingsContracts(asset);

        emit Withdraw(asset, amount);

        address iouToken = getYieldTokenAddress(asset);

        IERC20(iouToken).safeTransferFrom(msg.sender, address(this), amount);

        _withdraw(asset, saveAddress, amount);
    }

    /**
     * @dev Withdraw all tokens from the strategy
     * @param asset the address of token
     **/
    function withdrawAll(address asset) external override onlySymphony {
        address saveAddress = savingManager.savingsContracts(asset);
        uint256 amount = ISaveContract(saveAddress).balanceOfUnderlying(
            symphony
        );

        address iouToken = getYieldTokenAddress(asset);

        IERC20(iouToken).safeTransferFrom(msg.sender, address(this), amount);

        _withdraw(asset, saveAddress, amount);
    }

    /**
     * @dev Used to approve max token from yield provider contract
     * @param asset the address of token
     **/
    function maxApprove(address asset) external override {
        address saveAddress = savingManager.savingsContracts(asset);
        IERC20(asset).safeApprove(saveAddress, uint256(-1));
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
        public
        view
        override
        returns (address iouToken)
    {
        address saveAddress = savingManager.savingsContracts(asset);
        iouToken = ISaveContract(saveAddress).underlying();
    }

    function setOrderRewardDebt(
        bytes32,
        address,
        uint256,
        uint256
    ) external override {}

    function _withdraw(
        address asset,
        address saveAddress,
        uint256 amount
    ) internal {
        uint256 receivedAmount = ISaveContract(saveAddress).redeem(amount);
        IERC20(asset).safeTransfer(symphony, receivedAmount);
    }

    function updatePendingReward(address, uint256) external override {}
}

interface ISaveContract {
    /** @dev Saver privs */
    function depositSavings(uint256 _amount, address _beneficiary)
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
