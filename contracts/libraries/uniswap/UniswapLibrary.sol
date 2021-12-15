// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.8.10;

import "../../interfaces/uniswap/IUniswapPair.sol";

library UniswapLibrary {
    /**
     * @notice Returns the current block timestamp within the range of uint32, i.e. [0, 2**32 - 1]
     * @return uint32 - block timestamp
     */
    function currentBlockTimestamp() internal view returns (uint32) {
        return uint32(block.timestamp % 2**32);
    }

    /**
     * @notice Returns sorted token addresses, used to handle return values from pairs sorted in this order
     * @param _tokenA - Address of the token A
     * @param _tokenB - Address of the token B
     * @return token0 - Address of the lower token
     * @return token1 - Address of the higher token
     */
    function sortTokens(address _tokenA, address _tokenB)
        internal
        pure
        returns (address token0, address token1)
    {
        require(
            _tokenA != _tokenB,
            "UniswapUtils#sortTokens: IDENTICAL_ADDRESSES"
        );
        (token0, token1) = _tokenA < _tokenB
            ? (_tokenA, _tokenB)
            : (_tokenB, _tokenA);
        require(token0 != address(0), "UniswapUtils#sortTokens: ZERO_ADDRESS");
    }

    /**
     * @notice Calculates the CREATE2 address for a pair without making any external calls
     * @param _factory - Address of the sushiswapV2 factory contract
     * @param _tokenA - Address of the token A
     * @param _tokenB - Address of the token B
     * @param _initCodeHash - Bytes32 of the sushiswap v2 pair contract unit code hash
     * @return pair - Address of the pair
     */
    function pairFor(
        address _factory,
        address _tokenA,
        address _tokenB,
        bytes32 _initCodeHash
    ) internal pure returns (address pair) {
        (address token0, address token1) = sortTokens(_tokenA, _tokenB);
        pair = address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            hex"ff",
                            _factory,
                            keccak256(abi.encodePacked(token0, token1)),
                            _initCodeHash // init code hash
                        )
                    )
                )
            )
        );
    }

    /**
     * @notice Calculates the CREATE2 address for a pair without making any external calls
     * @dev Tokens should be in order
     * @param _factory - Address of the sushiswapV2 factory contract
     * @param _token0 - Address of the token 0
     * @param _token1 - Address of the token 1
     * @param _initCodeHash - Bytes32 of the sushiswap v2 pair contract unit code hash
     * @return pair - Address of the pair
     */
    function pairForSorted(
        address _factory,
        address _token0,
        address _token1,
        bytes32 _initCodeHash
    ) internal pure returns (address pair) {
        pair = address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            hex"ff",
                            _factory,
                            keccak256(abi.encodePacked(_token0, _token1)),
                            _initCodeHash // init code hash
                        )
                    )
                )
            )
        );
    }

    /**
     * @notice Given an input amount of an asset and pair reserves, returns the maximum output amount of the other asset
     * @param _inputAmount - uint of the input token's amount
     * @param _reserveIn - uint of the input token's reserve
     * @param _reserveOut - uint of the output token's reserve
     * @return amountOut - Maximum output amount
     */
    function getAmountOut(
        uint256 _inputAmount,
        uint256 _reserveIn,
        uint256 _reserveOut
    ) internal pure returns (uint256 amountOut) {
        require(
            _inputAmount > 0,
            "UniswapUtils#getAmountOut: INSUFFICIENT_INPUT_AMOUNT"
        );
        // require(
        //     _reserveIn > 0 && _reserveOut > 0,
        //     "UniswapUtils#getAmountOut: INSUFFICIENT_LIQUIDITY"
        // );
        uint256 inputAmountWithFee = _inputAmount * 997;
        uint256 numerator = inputAmountWithFee * _reserveOut;
        uint256 denominator = (_reserveIn * 1000) + inputAmountWithFee;
        if (denominator > 0) {
            amountOut = numerator / denominator;
        }
    }

    // performs chained getAmountOut calculations on any number of pairs
    function getAmountsOut(
        address factory,
        uint256 amountIn,
        address[] memory path,
        bytes32 initcodehash
    ) internal view returns (uint256[] memory amounts) {
        require(path.length >= 2, "UniswapV2Library: INVALID_PATH");
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i; i < path.length - 1; i++) {
            (uint256 reserveIn, uint256 reserveOut) = getReserves(
                factory,
                path[i],
                path[i + 1],
                initcodehash
            );
            amounts[i + 1] = getAmountOut(amounts[i], reserveIn, reserveOut);
        }
    }

    // fetches and sorts the reserves for a pair
    function getReserves(
        address factory,
        address tokenA,
        address tokenB,
        bytes32 initcodehash
    ) internal view returns (uint256 reserveA, uint256 reserveB) {
        (address token0, ) = sortTokens(tokenA, tokenB);
        address pairAddress = pairFor(factory, tokenA, tokenB, initcodehash);

        uint256 size;
        assembly {
            size := extcodesize(pairAddress)
        }

        if (size > 0) {
            IUniswapPair pair = IUniswapPair(pairAddress);
            (uint256 reserve0, uint256 reserve1, ) = pair.getReserves();

            (reserveA, reserveB) = tokenA == token0
                ? (reserve0, reserve1)
                : (reserve1, reserve0);
        } else {
            reserveA = 0;
            reserveB = 0;
        }
    }
}
