// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import {IWETH} from "./interfaces/IWETH.sol";
import {ISymphony} from "./interfaces/ISymphony.sol";

contract WETHGateway is Initializable, OwnableUpgradeable {
    IWETH internal WETH;
    ISymphony internal symphony;

    function initialize(
        address _weth,
        address _owner,
        address _symphony
    ) external initializer {
        WETH = IWETH(_weth);
        symphony = ISymphony(_symphony);
        __Ownable_init();
        super.transferOwnership(_owner);
        maxApproveSymphony();
    }

    function createEthOrder(
        address recipient,
        address outputToken,
        uint256 minReturnAmount,
        uint256 stoplossAmount
    ) external payable returns (bytes32) {
        WETH.deposit{value: msg.value}();

        return symphony.createOrder(
            recipient,
            address(WETH),
            outputToken,
            msg.value,
            minReturnAmount,
            stoplossAmount
        );
    }

    function _safeTransferETH(address to, uint256 value) internal {
        (bool success, ) = to.call{value: value}(new bytes(0));
        require(success, "ETH transfer failed");
    }

    function maxApproveSymphony() internal {
        WETH.approve(address(symphony), uint256(-1));
    }
}
