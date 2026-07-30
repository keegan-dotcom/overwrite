// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IOverwriteVault} from "./interfaces/IOverwriteVault.sol";

/// @title VaultFactory
/// @notice Deploys OverwriteVault UUPS proxies (one vault per base asset listing) and keeps
///         an on-chain registry. Ownership sits with the Overwrite multisig; each vault's
///         own admin is set per-deployment via `InitParams.admin` (vaults do not depend on
///         the factory after creation).
contract VaultFactory is Ownable {
    /// @notice Current OverwriteVault implementation used for new proxies.
    address public implementation;

    /// @notice All vaults ever deployed by this factory.
    address[] public allVaults;
    /// @notice Vaults deployed for a given base asset (multiple strategies per asset allowed).
    mapping(address asset => address[]) public vaultsByAsset;
    /// @notice True for any vault deployed by this factory.
    mapping(address vault => bool) public isVault;

    event ImplementationSet(address indexed implementation);
    event VaultCreated(address indexed vault, address indexed asset, string name, string symbol);

    error ZeroAddress();

    constructor(address implementation_, address owner_) Ownable(owner_) {
        if (implementation_ == address(0)) revert ZeroAddress();
        implementation = implementation_;
        emit ImplementationSet(implementation_);
    }

    /// @notice Point new deployments at a new implementation (existing vaults unaffected;
    ///         they upgrade themselves via their own admin's UUPS path).
    function setImplementation(address implementation_) external onlyOwner {
        if (implementation_ == address(0)) revert ZeroAddress();
        implementation = implementation_;
        emit ImplementationSet(implementation_);
    }

    /// @notice Deploy and initialize a new OverwriteVault proxy.
    function createVault(IOverwriteVault.InitParams calldata p) external onlyOwner returns (address vault) {
        vault = address(
            new ERC1967Proxy(implementation, abi.encodeCall(IOverwriteVault.initialize, (p)))
        );
        allVaults.push(vault);
        vaultsByAsset[p.asset].push(vault);
        isVault[vault] = true;
        emit VaultCreated(vault, p.asset, p.name, p.symbol);
    }

    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }
}
