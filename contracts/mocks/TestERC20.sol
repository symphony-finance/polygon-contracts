// SPDX-License-Identifier: agpl-3.0

pragma solidity 0.8.10;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestERC20 is ERC20 {
    constructor() ERC20("TestERC20", "TYE") {
        _mint(msg.sender, 10000 * 10**18);
    }
}
