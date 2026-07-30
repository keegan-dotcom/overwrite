# Overwrite — Contracts

Morpho-style covered-call vaults for [Derive](https://derive.xyz) (Derive Chain, OP-stack rollup, chain id 957). One upgradeable ERC-20 share vault per base asset (WETH, WBTC, and tokenized equities like AAPLx once Derive lists them — the vault is asset-agnostic). Settlement/quote asset for the option strategy is USDC on Derive; the vault itself only ever holds and accounts in its base asset.

## Architecture

```
                                   deposit(assets) / requestWithdraw(shares) / claim()
        Users ─────────────────────────────────────────────────────────┐
                                                                       ▼
  ┌───────────────┐  createVault(params)   ┌──────────────────────────────────────────┐
  │  VaultFactory │ ─────────────────────▶ │  OverwriteVault (ERC1967 proxy, UUPS)    │
  │  (Ownable,    │   registry:            │  ERC-20 shares, 1 base asset             │
  │   multisig)   │   allVaults[],         │                                          │
  └───────────────┘   vaultsByAsset        │  totalAssets = liquid balance            │
                                           │              + strategyValue (reported)  │
       KEEPER (off-chain agent) ─────────▶ │  moveToStrategy / returnFromStrategy     │
         updateStrategyValue(value, ts)    │  processWithdrawals (FIFO queue)         │
       GUARDIAN ── pause()                 │  fees: mgmt (≤2%/yr) + perf (≤30%, HWM)  │
       ADMIN (multisig) ── params/upgrade  └────────────────────┬─────────────────────┘
                                                                │ moveToStrategy(amount)
                                                                ▼
                                           ┌──────────────────────────────────────────┐
                                           │  strategyDepositTarget                   │
                                           │  (Derive deposit module / bridge)        │
                                           │        │                                 │
                                           │        ▼                                 │
                                           │  Derive Protocol subaccount ("TSA")      │
                                           │  agent (session key) sells covered calls │
                                           └──────────────────────────────────────────┘
```

Files:

- `contracts/OverwriteVault.sol` — UUPS-upgradeable share vault: deposits, withdrawal queue, keeper-reported strategy accounting, fee accrual, roles, pause.
- `contracts/VaultFactory.sol` — owner-only deployer of vault proxies + on-chain registry.
- `contracts/interfaces/IOverwriteVault.sol` — external interface + `InitParams`.
- `contracts/test/MockERC20.sol` — test-only, never deployed.

## Design notes

**Why not full ERC-4626.** `asset()`, `totalAssets()`, `convertToShares()`, `convertToAssets()` follow 4626 semantics for integrations, but synchronous `withdraw`/`redeem` cannot exist: deposited capital is locked as option collateral on Derive until expiry or unwind. Exits are queued (`requestWithdraw` escrows shares → keeper `processWithdrawals` prices them FIFO at the then-current share price once liquidity allows → user `claim`s). Processed proceeds are reserved (`totalClaimable`) and excluded from `totalAssets` so late claimers aren't diluted.

**Share price & inflation-attack guard.** OZ 4626-style virtual-shares offset (share decimals = asset decimals + 3, `+1` virtual asset). A donation attack strictly loses the attacker more than any victim can lose — covered by an explicit test.

**Fees.** Management fee accrues linearly on `totalAssets` and performance fee applies to share-price gains above a high-water mark (ratcheted to the post-fee price, so no double charging). Both paid by minting shares to `feeRecipient`. Hard caps in code: 200 bps mgmt, 3000 bps perf.

## Trust assumptions — read before depositing

1. **Strategy value is operator-reported.** Derive does not (yet) expose on-chain subaccount margin reads, so `strategyValue` — up to ~95% of `totalAssets` — is pushed by the KEEPER via `updateStrategyValue`. Guards: per-update deviation bound (`maxDeviationBps`), staleness window (`maxStaleness`, blocking deposits and withdrawal processing while stale), and events for off-chain monitoring. A malicious keeper colluding with `feeRecipient` can still skew the share price *within those bounds each update*. When Derive ships on-chain margin reads, `updateStrategyValue` should be replaced by a direct read (one upgrade).
2. **`moveToStrategy` sends funds to a configurable address.** ADMIN sets `strategyDepositTarget`; a compromised admin can redirect deployed capital. ADMIN must be a multisig (recommended: timelocked).
3. **Withdrawals depend on the keeper.** The queue is processed by the KEEPER; a dead keeper strands exits until the ADMIN rotates the role. Funds never leave the vault without keeper/admin action.
4. **UUPS upgradeability.** ADMIN can upgrade the vault implementation arbitrarily.
5. **Off-chain agent risk.** The session-key agent trading on Derive can lose money within the subaccount (bad strikes, liquidation). `forceStrategyValue` exists so the ADMIN can mark down after a liquidation that exceeds the deviation bound.

## Build & test

```bash
npm install
npx hardhat compile
npx hardhat test
```

Note: this repo pins `solc@0.8.24` from npm and overrides Hardhat's compiler download (some CI environments can't reach `binaries.soliditylang.org`). Delete that subtask in `hardhat.config.js` if you prefer the native binary.

## Deployment — Derive Chain

Derive Chain is **DAO-whitelisted for contract deployment**: the deployer EOA must be added to the Derive DAO's deployer whitelist before any `CREATE` will succeed. Submit the deployer address (and ideally this audited artifact set) through Derive governance before scheduling a deploy.

Testnet (Derive's Conduit testnet):

```bash
export DERIVE_TESTNET_RPC_URL="https://rpc-<your-conduit-slug>.t.conduit.xyz"  # from https://docs.derive.xyz
export DERIVE_TESTNET_CHAIN_ID=901        # confirm against current Conduit config
export DEPLOYER_PK=0x...                  # whitelisted deployer
npx hardhat run scripts/deploy.js --network deriveTestnet   # or use hardhat console
```

Order of operations:

1. Deploy `OverwriteVault` implementation (constructor disables initializers).
2. Deploy `VaultFactory(implementation, multisigOwner)`.
3. `factory.createVault(InitParams)` per base asset. Suggested initial params: `maxUtilizationBps = 9500`, `maxDeviationBps = 1000`, `maxStaleness = 86400`, `mgmtFeeBps ≤ 200`, `perfFeeBps ≤ 3000`, conservative `depositCap`.
4. Point `strategyDepositTarget` at the Derive deposit module for the base asset; register the agent's session key on the subaccount out-of-band.
5. Verify roles: ADMIN = multisig, KEEPER = agent hot wallet, GUARDIAN = fast-response signer.

Mainnet uses `--network deriveMainnet` (chain id 957, default RPC `https://rpc.lyra.finance`, overridable via `DERIVE_RPC_URL`).

## Audit status

**UNAUDITED.** These contracts have not been reviewed by any third-party auditor. They carry meaningful trust assumptions (operator-reported NAV, upgradeable proxies, admin-configurable fund destinations) on top of ordinary smart-contract risk. Do not deposit funds you cannot afford to lose; do not deploy to mainnet before at least one independent audit and an economic review of the keeper-reporting guards.
