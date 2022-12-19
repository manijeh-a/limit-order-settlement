// SPDX-License-Identifier: MIT

pragma solidity 0.8.17;

import "../libraries/DynamicSuffix.sol";

interface IResolver {
    function resolveOrders(address resolver, DynamicSuffix.TokenAndAmount[] calldata tokensAndAmounts, bytes calldata data) external;
}
