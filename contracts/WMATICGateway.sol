// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import {IWETH as IWMATIC} from "./interfaces/IWETH.sol";
import {ISymphony} from "./interfaces/ISymphony.sol";

contract WMATICGateway is Initializable, OwnableUpgradeable {
    IWMATIC internal WMATIC;
    ISymphony internal symphony;

    function initialize(
        address _wmatic,
        address _owner,
        address _symphony
    ) external initializer {
        WMATIC = IWMATIC(_wmatic);
        symphony = ISymphony(_symphony);
        __Ownable_init();
        super.transferOwnership(_owner);
        maxApproveSymphony();
    }

    function createMaticOrder(
        address recipient,
        address outputToken,
        uint256 minReturnAmount,
        uint256 stoplossAmount
    ) external payable returns (bytes32) {
        WMATIC.deposit{value: msg.value}();

        return
            symphony.createOrder(
                recipient,
                address(WMATIC),
                outputToken,
                msg.value,
                minReturnAmount,
                stoplossAmount
            );
    }

    function maxApproveSymphony() internal {
        WMATIC.approve(address(symphony), uint256(-1));
    }
}
