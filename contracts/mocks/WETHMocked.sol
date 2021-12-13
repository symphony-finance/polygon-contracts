// SPDX-License-Identifier: agpl-3.0
pragma solidity >=0.4.22 <=0.8.10;

import {WETH9} from "./WETH9.sol";

contract WETHMocked is WETH9 {
    // Mint not backed by Ether: only for testing purposes
    function mint(uint256 value) public returns (bool success) {
        balanceOf[msg.sender] += value;
        success = true;
        emit Transfer(address(0), msg.sender, value);
    }
}
