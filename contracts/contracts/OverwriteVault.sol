// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.24;

import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20, SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IOverwriteVault} from "./interfaces/IOverwriteVault.sol";

/// @title OverwriteVault
/// @notice UUPS-upgradeable ERC-20 share vault for ONE base asset, wrapping a Derive
///         Protocol subaccount ("TSA" pattern) in which an off-chain agent sells covered calls.
///
/// @dev ACCOUNTING / TRUST ASSUMPTION (read this first):
///      `totalAssets = liquid base balance held here + strategyValue`, where `strategyValue`
///      is the base-denominated mark-to-market of the Derive subaccount **reported by the
///      KEEPER via `updateStrategyValue`**. Until Derive exposes on-chain subaccount margin
///      reads, strategy value is an operator-supplied oracle. Guards: a staleness window
///      (deposits/withdraw-processing halt if the report is old while capital is deployed)
///      and a per-update deviation bound. A malicious keeper + feeRecipient could still
///      skew the share price within those bounds — depositors must trust the operator.
///
///      ERC-4626 NOTE: `convertToShares/convertToAssets/totalAssets/asset` follow 4626
///      semantics, but full 4626 (synchronous `withdraw/redeem`) cannot hold: deposited
///      capital is locked as option collateral on Derive until expiry/unwind, so exits go
///      through a withdrawal queue (`requestWithdraw` -> keeper `processWithdrawals` -> `claim`).
contract OverwriteVault is
    Initializable,
    ERC20Upgradeable,
    AccessControlUpgradeable,
    PausableUpgradeable,
    ReentrancyGuard, // OZ >=5.5: namespaced-slot guard, safe under proxies (@custom:stateless)
    UUPSUpgradeable,
    IOverwriteVault
{
    using SafeERC20 for IERC20;
    using Math for uint256;

    // ---------------------------------------------------------------- constants
    bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");
    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    uint16 public constant MAX_MGMT_FEE_BPS = 200; // 2%/yr hard cap
    uint16 public constant MAX_PERF_FEE_BPS = 3000; // 30% hard cap
    uint256 private constant BPS = 10_000;
    uint256 private constant YEAR = 365 days;
    /// @dev Virtual-shares decimals offset (OZ 4626-style inflation-attack mitigation).
    uint8 private constant DECIMALS_OFFSET = 3;

    // ---------------------------------------------------------------- storage
    IERC20 private _asset;
    uint8 private _underlyingDecimals;

    uint256 public depositCap;
    uint256 public minDeposit;

    // strategy accounting (keeper-reported; see contract-level NatSpec)
    uint256 public strategyValue;
    uint256 public strategyValueUpdatedAt;
    uint256 public maxStaleness;
    uint16 public maxDeviationBps;
    uint16 public maxUtilizationBps;
    uint256 public maxMovePerTx;
    address public strategyDepositTarget;

    // fees
    uint16 public mgmtFeeBps;
    uint16 public perfFeeBps;
    address public feeRecipient;
    uint256 public lastFeeAccrual;
    uint256 public highWaterMark; // assets per 10**decimals() shares

    // withdrawal queue
    struct WithdrawRequest {
        address user;
        uint256 shares;
    }
    WithdrawRequest[] public queue;
    uint256 public queueHead;
    mapping(address => uint256) public claimable; // base units ready to claim
    uint256 public totalClaimable; // base units reserved for claims

    uint256[38] private __gap;

    // ---------------------------------------------------------------- events
    event Deposited(address indexed user, uint256 assets, uint256 shares);
    event WithdrawRequested(address indexed user, uint256 indexed id, uint256 shares);
    event WithdrawProcessed(address indexed user, uint256 indexed id, uint256 shares, uint256 assets);
    event Claimed(address indexed user, uint256 assets);
    event StrategyValueUpdated(uint256 oldValue, uint256 newValue, uint256 timestamp);
    event MovedToStrategy(address indexed target, uint256 amount);
    event ReturnedFromStrategy(uint256 amount);
    event FeesAccrued(uint256 mgmtShares, uint256 perfShares, uint256 newHighWaterMark);
    event CapsSet(uint256 depositCap, uint256 minDeposit);
    event FeesSet(uint16 mgmtFeeBps, uint16 perfFeeBps, address feeRecipient);
    event StrategyParamsSet(
        address target, uint16 maxUtilizationBps, uint16 maxDeviationBps, uint256 maxMovePerTx, uint256 maxStaleness
    );

    // ---------------------------------------------------------------- errors
    error ZeroAmount();
    error ZeroAddress();
    error DepositCapExceeded();
    error BelowMinDeposit();
    error StaleStrategyValue();
    error DeviationExceeded();
    error UtilizationCapExceeded();
    error PerTxCapExceeded();
    error InsufficientLiquidity();
    error InsufficientStrategyValue();
    error NothingToClaim();
    error FeeCapExceeded();
    error InvalidBps();
    error InvalidTimestamp();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @inheritdoc IOverwriteVault
    function initialize(InitParams calldata p) external initializer {
        if (p.asset == address(0) || p.admin == address(0) || p.feeRecipient == address(0)) revert ZeroAddress();
        if (p.mgmtFeeBps > MAX_MGMT_FEE_BPS || p.perfFeeBps > MAX_PERF_FEE_BPS) revert FeeCapExceeded();
        if (p.maxUtilizationBps > BPS || p.maxDeviationBps > BPS) revert InvalidBps();

        __ERC20_init(p.name, p.symbol);
        __AccessControl_init();
        __Pausable_init(); // UUPSUpgradeable + ReentrancyGuard are stateless in OZ >=5.5, no init

        _grantRole(DEFAULT_ADMIN_ROLE, p.admin);
        _grantRole(KEEPER_ROLE, p.keeper);
        _grantRole(GUARDIAN_ROLE, p.guardian);

        _asset = IERC20(p.asset);
        _underlyingDecimals = IERC20Metadata(p.asset).decimals();
        depositCap = p.depositCap;
        minDeposit = p.minDeposit;
        mgmtFeeBps = p.mgmtFeeBps;
        perfFeeBps = p.perfFeeBps;
        feeRecipient = p.feeRecipient;
        strategyDepositTarget = p.strategyDepositTarget;
        maxUtilizationBps = p.maxUtilizationBps;
        maxDeviationBps = p.maxDeviationBps;
        maxMovePerTx = p.maxMovePerTx;
        maxStaleness = p.maxStaleness;
        lastFeeAccrual = block.timestamp;
        strategyValueUpdatedAt = block.timestamp;
        highWaterMark = 10 ** _underlyingDecimals; // 1 whole share : 1 whole asset at genesis
    }

    // ---------------------------------------------------------------- user flow

    /// @notice Deposit `assets` of the base asset; mints shares at the current share price.
    /// @dev Reverts while paused, above `depositCap`, below `minDeposit`, or when the
    ///      keeper-reported strategy value is stale with capital deployed.
    function deposit(uint256 assets) external nonReentrant whenNotPaused returns (uint256 shares) {
        if (assets == 0) revert ZeroAmount();
        if (assets < minDeposit) revert BelowMinDeposit();
        _requireFreshStrategyValue();
        _accrueFees();
        if (totalAssets() + assets > depositCap) revert DepositCapExceeded();
        shares = _convertToShares(assets, Math.Rounding.Floor);
        _asset.safeTransferFrom(msg.sender, address(this), assets);
        _mint(msg.sender, shares);
        emit Deposited(msg.sender, assets, shares);
    }

    /// @notice Queue `shares` for withdrawal. Shares are escrowed in the vault and priced
    ///         when the keeper processes the queue (funds may be locked as option collateral).
    function requestWithdraw(uint256 shares) external nonReentrant returns (uint256 id) {
        if (shares == 0) revert ZeroAmount();
        _transfer(msg.sender, address(this), shares); // escrow; reverts on insufficient balance
        id = queue.length;
        queue.push(WithdrawRequest({user: msg.sender, shares: shares}));
        emit WithdrawRequested(msg.sender, id, shares);
    }

    /// @notice Process up to `maxItems` queued withdrawals FIFO at the current share price.
    /// @dev Keeper-only. Stops (without reverting) when liquid balance can't cover the next
    ///      request, so the keeper first recalls collateral via `returnFromStrategy`.
    function processWithdrawals(uint256 maxItems) external nonReentrant onlyRole(KEEPER_ROLE) returns (uint256 processed) {
        _requireFreshStrategyValue();
        _accrueFees();
        uint256 head = queueHead;
        uint256 end = Math.min(queue.length, head + maxItems);
        while (head < end) {
            WithdrawRequest memory r = queue[head];
            uint256 assets = _convertToAssets(r.shares, Math.Rounding.Floor);
            if (assets > _liquidBalance()) break;
            _burn(address(this), r.shares);
            claimable[r.user] += assets;
            totalClaimable += assets;
            emit WithdrawProcessed(r.user, head, r.shares, assets);
            unchecked { ++head; ++processed; }
        }
        queueHead = head;
    }

    /// @notice Pull all processed withdrawal proceeds owed to the caller.
    function claim() external nonReentrant returns (uint256 assets) {
        assets = claimable[msg.sender];
        if (assets == 0) revert NothingToClaim();
        claimable[msg.sender] = 0;
        totalClaimable -= assets;
        _asset.safeTransfer(msg.sender, assets);
        emit Claimed(msg.sender, assets);
    }

    // ---------------------------------------------------------------- keeper flow

    /// @notice Report the base-denominated value of the Derive subaccount.
    /// @dev TRUST ASSUMPTION: this is an operator-supplied oracle (no on-chain Derive margin
    ///      read exists yet). Bounded by `maxDeviationBps` per update; `timestamp` must be
    ///      the observation time (not in the future, not older than the previous report).
    function updateStrategyValue(uint256 newValue, uint256 timestamp) external onlyRole(KEEPER_ROLE) {
        if (timestamp > block.timestamp || timestamp < strategyValueUpdatedAt) revert InvalidTimestamp();
        uint256 old = strategyValue;
        if (old != 0) {
            uint256 delta = newValue > old ? newValue - old : old - newValue;
            if (delta > old.mulDiv(maxDeviationBps, BPS)) revert DeviationExceeded();
        }
        _accrueFees(); // accrue on the pre-update basis
        strategyValue = newValue;
        strategyValueUpdatedAt = timestamp;
        emit StrategyValueUpdated(old, newValue, timestamp);
    }

    /// @notice Move `amount` of liquid base asset to `strategyDepositTarget` (Derive deposit
    ///         module / bridge). Increments `strategyValue` by principal moved.
    function moveToStrategy(uint256 amount) external nonReentrant whenNotPaused onlyRole(KEEPER_ROLE) {
        if (amount == 0) revert ZeroAmount();
        if (amount > maxMovePerTx) revert PerTxCapExceeded();
        if (amount > _liquidBalance()) revert InsufficientLiquidity();
        uint256 deployed = strategyValue + amount;
        if (deployed > totalAssets().mulDiv(maxUtilizationBps, BPS)) revert UtilizationCapExceeded();
        strategyValue = deployed;
        strategyValueUpdatedAt = block.timestamp; // keeper asserts accounting at move time
        _asset.safeTransfer(strategyDepositTarget, amount);
        emit MovedToStrategy(strategyDepositTarget, amount);
    }

    /// @notice Book `amount` of base asset returned from the strategy. MUST be called after
    ///         the bridge withdrawal has credited this vault, otherwise assets double-count.
    function returnFromStrategy(uint256 amount) external onlyRole(KEEPER_ROLE) {
        if (amount == 0) revert ZeroAmount();
        if (amount > strategyValue) revert InsufficientStrategyValue();
        strategyValue -= amount;
        strategyValueUpdatedAt = block.timestamp;
        emit ReturnedFromStrategy(amount);
    }

    // ---------------------------------------------------------------- admin / guardian

    /// @notice Guardian or admin: instantly halt deposits and strategy deployment.
    function pause() external {
        if (!hasRole(GUARDIAN_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, GUARDIAN_ROLE);
        }
        _pause();
    }

    /// @notice Admin-only unpause.
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function setCaps(uint256 depositCap_, uint256 minDeposit_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        depositCap = depositCap_;
        minDeposit = minDeposit_;
        emit CapsSet(depositCap_, minDeposit_);
    }

    /// @notice Update fee config; accrues outstanding fees at the old rates first.
    function setFees(uint16 mgmtFeeBps_, uint16 perfFeeBps_, address feeRecipient_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (mgmtFeeBps_ > MAX_MGMT_FEE_BPS || perfFeeBps_ > MAX_PERF_FEE_BPS) revert FeeCapExceeded();
        if (feeRecipient_ == address(0)) revert ZeroAddress();
        _accrueFees();
        mgmtFeeBps = mgmtFeeBps_;
        perfFeeBps = perfFeeBps_;
        feeRecipient = feeRecipient_;
        emit FeesSet(mgmtFeeBps_, perfFeeBps_, feeRecipient_);
    }

    function setStrategyParams(
        address target,
        uint16 maxUtilizationBps_,
        uint16 maxDeviationBps_,
        uint256 maxMovePerTx_,
        uint256 maxStaleness_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (target == address(0)) revert ZeroAddress();
        if (maxUtilizationBps_ > BPS || maxDeviationBps_ > BPS) revert InvalidBps();
        strategyDepositTarget = target;
        maxUtilizationBps = maxUtilizationBps_;
        maxDeviationBps = maxDeviationBps_;
        maxMovePerTx = maxMovePerTx_;
        maxStaleness = maxStaleness_;
        emit StrategyParamsSet(target, maxUtilizationBps_, maxDeviationBps_, maxMovePerTx_, maxStaleness_);
    }

    /// @notice Admin escape hatch: set strategy value bypassing the deviation guard
    ///         (e.g. after a liquidation on Derive). Same trust assumption as updates.
    function forceStrategyValue(uint256 newValue) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _accrueFees(); // same pre-update basis as updateStrategyValue
        uint256 old = strategyValue;
        strategyValue = newValue;
        strategyValueUpdatedAt = block.timestamp;
        emit StrategyValueUpdated(old, newValue, block.timestamp);
    }

    // ---------------------------------------------------------------- views

    /// @inheritdoc IOverwriteVault
    function asset() external view returns (address) {
        return address(_asset);
    }

    /// @notice Liquid balance + keeper-reported strategy value, minus assets reserved for claims.
    function totalAssets() public view returns (uint256) {
        return _liquidBalance() + strategyValue;
    }

    /// @inheritdoc IOverwriteVault
    function convertToShares(uint256 assets) external view returns (uint256) {
        return _convertToShares(assets, Math.Rounding.Floor);
    }

    /// @inheritdoc IOverwriteVault
    function convertToAssets(uint256 shares) external view returns (uint256) {
        return _convertToAssets(shares, Math.Rounding.Floor);
    }

    /// @notice Assets per 10**decimals() shares.
    function pricePerShare() public view returns (uint256) {
        return _convertToAssets(10 ** decimals(), Math.Rounding.Floor);
    }

    /// @notice Pending queue length (requests not yet processed).
    function pendingWithdrawals() external view returns (uint256) {
        return queue.length - queueHead;
    }

    /// @dev Share decimals = asset decimals + virtual offset (OZ 4626 inflation-attack guard).
    function decimals() public view override returns (uint8) {
        return _underlyingDecimals + DECIMALS_OFFSET;
    }

    // ---------------------------------------------------------------- internal

    function _liquidBalance() internal view returns (uint256) {
        return _asset.balanceOf(address(this)) - totalClaimable;
    }

    function _convertToShares(uint256 assets, Math.Rounding rounding) internal view returns (uint256) {
        return assets.mulDiv(totalSupply() + 10 ** DECIMALS_OFFSET, totalAssets() + 1, rounding);
    }

    function _convertToAssets(uint256 shares, Math.Rounding rounding) internal view returns (uint256) {
        return shares.mulDiv(totalAssets() + 1, totalSupply() + 10 ** DECIMALS_OFFSET, rounding);
    }

    function _requireFreshStrategyValue() internal view {
        if (strategyValue != 0 && block.timestamp > strategyValueUpdatedAt + maxStaleness) {
            revert StaleStrategyValue();
        }
    }

    /// @dev Accrue management fee (time-based dilution) then performance fee (share-price
    ///      gain above the high-water mark). Both are paid by minting shares to `feeRecipient`.
    function _accrueFees() internal {
        uint256 supply = totalSupply();
        uint256 elapsed = block.timestamp - lastFeeAccrual;
        lastFeeAccrual = block.timestamp;
        if (supply == 0) return;

        uint256 mgmtShares;
        if (mgmtFeeBps != 0 && elapsed != 0) {
            uint256 assets = totalAssets();
            uint256 feeAssets = assets.mulDiv(uint256(mgmtFeeBps) * elapsed, BPS * YEAR);
            mgmtShares = _feeShares(feeAssets);
            if (mgmtShares != 0) _mint(feeRecipient, mgmtShares);
        }

        uint256 perfShares;
        uint256 price = pricePerShare();
        if (price > highWaterMark) {
            if (perfFeeBps != 0) {
                uint256 profitAssets = (price - highWaterMark).mulDiv(totalSupply(), 10 ** decimals());
                perfShares = _feeShares(profitAssets.mulDiv(perfFeeBps, BPS));
                if (perfShares != 0) _mint(feeRecipient, perfShares);
            }
            highWaterMark = pricePerShare(); // post-fee price becomes the new mark
        }
        if (mgmtShares != 0 || perfShares != 0) emit FeesAccrued(mgmtShares, perfShares, highWaterMark);
    }

    /// @dev Shares to mint so that `feeAssets` of value is transferred to the recipient.
    function _feeShares(uint256 feeAssets) internal view returns (uint256) {
        uint256 assets = totalAssets();
        if (feeAssets == 0 || feeAssets >= assets) return 0;
        return feeAssets.mulDiv(totalSupply() + 10 ** DECIMALS_OFFSET, assets - feeAssets + 1);
    }

    /// @dev Only the admin multisig may authorize UUPS upgrades.
    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
