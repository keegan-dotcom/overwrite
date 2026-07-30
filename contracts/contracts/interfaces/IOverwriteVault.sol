// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

/// @title IOverwriteVault
/// @notice External interface for Overwrite covered-call vaults (one vault per base asset).
interface IOverwriteVault {
    /// @notice Constructor-equivalent parameters for a vault proxy.
    /// @dev Grouped in a struct so VaultFactory can forward them in one calldata word-set.
    struct InitParams {
        address asset; // base asset (WETH, WBTC, AAPLx, ...)
        string name; // share token name
        string symbol; // share token symbol
        address admin; // DEFAULT_ADMIN_ROLE (multisig)
        address keeper; // KEEPER_ROLE (off-chain agent / session-key operator)
        address guardian; // GUARDIAN_ROLE (instant pause)
        address feeRecipient; // receives fee shares
        address strategyDepositTarget; // Derive deposit module / bridge
        uint256 depositCap; // max totalAssets, in base units
        uint256 minDeposit; // min single deposit, in base units (0 = none)
        uint16 mgmtFeeBps; // annualized management fee, <= 200
        uint16 perfFeeBps; // performance fee above HWM, <= 3000
        uint16 maxUtilizationBps; // max share of totalAssets deployed to strategy
        uint16 maxDeviationBps; // max +/- change per strategy-value update
        uint256 maxMovePerTx; // per-tx cap on moveToStrategy, in base units
        uint256 maxStaleness; // seconds before reported strategy value is stale
    }

    function initialize(InitParams calldata p) external;

    // --- User flow ---
    function deposit(uint256 assets) external returns (uint256 shares);
    function requestWithdraw(uint256 shares) external returns (uint256 id);
    function claim() external returns (uint256 assets);

    // --- Keeper flow ---
    function processWithdrawals(uint256 maxItems) external returns (uint256 processed);
    function updateStrategyValue(uint256 newValue, uint256 timestamp) external;
    function moveToStrategy(uint256 amount) external;
    function returnFromStrategy(uint256 amount) external;

    // --- ERC-4626-style views (queue-based flow; see vault NatSpec) ---
    function asset() external view returns (address);
    function totalAssets() external view returns (uint256);
    function convertToShares(uint256 assets) external view returns (uint256);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function pricePerShare() external view returns (uint256);
}
