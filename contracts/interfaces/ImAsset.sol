// SPDX-License-Identifier: agpl-3.0
pragma solidity 0.7.4;

interface ImAsset {
    /**
     * @dev Mint a single bAsset, at a 1:1 ratio with the bAsset. This contract
     *      must have approval to spend the senders bAsset
     * @param _input             Address of the bAsset to deposit for the minted mAsset.
     * @param _inputQuantity     Quantity in bAsset units
     * @param _minOutputQuantity Minimum mAsset quanity to be minted. This protects against slippage.
     * @param _recipient         Receipient of the newly minted mAsset tokens
     * @return mintOutput        Quantity of newly minted mAssets for the deposited bAsset.
     */
    function mint(
        address _input,
        uint256 _inputQuantity,
        uint256 _minOutputQuantity,
        address _recipient
    ) external returns (uint256 mintOutput);

    /**
     * @dev Get the projected output of a given mint
     * @param _input             Address of the bAsset to deposit for the minted mAsset
     * @param _inputQuantity     Quantity in bAsset units
     * @return mintOutput        Estimated mint output in mAsset terms
     */
    function getMintOutput(address _input, uint256 _inputQuantity)
        external
        view
        returns (uint256 mintOutput);

    /**
     * @notice Redeems a specified quantity of mAsset in return for a bAsset specified by bAsset address.
     * The bAsset is sent to the specified recipient.
     * The bAsset quantity is relative to current vault balance levels and desired mAsset quantity.
     * The quantity of mAsset is burnt as payment.
     * A minimum quantity of bAsset is specified to protect against price slippage between the mAsset and bAsset.
     * @param _output            Address of the bAsset to receive
     * @param _mAssetQuantity    Quantity of mAsset to redeem
     * @param _minOutputQuantity Minimum bAsset quantity to receive for the burnt mAssets. This protects against slippage.
     * @param _recipient         Address to transfer the withdrawn bAssets to.
     * @return outputQuantity    Quanity of bAsset units received for the burnt mAssets
     */
    function redeem(
        address _output,
        uint256 _mAssetQuantity,
        uint256 _minOutputQuantity,
        address _recipient
    ) external returns (uint256 outputQuantity);

    /**
     * @notice Gets the estimated output from a given redeem
     * @param _output            Address of the bAsset to receive
     * @param _mAssetQuantity    Quantity of mAsset to redeem
     * @return bAssetOutput      Estimated quantity of bAsset units received for the burnt mAssets
     */
    function getRedeemOutput(address _output, uint256 _mAssetQuantity)
        external
        view
        returns (uint256 bAssetOutput);
}
