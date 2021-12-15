// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.10;

import "./IAaveAddressProvider.sol";
import "../../libraries/aave/AaveDataTypes.sol";

interface IAaveLendingPool {
    function deposit(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 referralCode
    ) external;

    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256);

    /**
     * @dev Returns the state and configuration of the reserve
     * @param asset The address of the underlying asset of the reserve
     * @return The state of the reserve
     **/
    function getReserveData(address asset)
        external
        view
        returns (AaveDataTypes.ReserveData memory);

    function getAddressesProvider()
        external
        view
        returns (IAaveAddressProvider);
}
