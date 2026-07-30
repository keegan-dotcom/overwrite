const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");
const { expect } = require("chai");
const { ethers } = require("hardhat");

const E18 = 10n ** 18n;
const DAY = 86400;
const YEAR = 365 * DAY;

describe("Overwrite contracts", function () {
  async function deployFixture() {
    const [deployer, admin, keeper, guardian, feeRecipient, alice, bob, attacker, strategyTarget] =
      await ethers.getSigners();

    const Mock = await ethers.getContractFactory("MockERC20");
    const weth = await Mock.deploy("Wrapped Ether", "WETH", 18);

    const Vault = await ethers.getContractFactory("OverwriteVault");
    const impl = await Vault.deploy();

    const Factory = await ethers.getContractFactory("VaultFactory");
    const factory = await Factory.deploy(await impl.getAddress(), deployer.address);

    const params = {
      asset: await weth.getAddress(),
      name: "Overwrite WETH Covered Call",
      symbol: "owWETH",
      admin: admin.address,
      keeper: keeper.address,
      guardian: guardian.address,
      feeRecipient: feeRecipient.address,
      strategyDepositTarget: strategyTarget.address,
      depositCap: 1000n * E18,
      minDeposit: 0n,
      mgmtFeeBps: 0,
      perfFeeBps: 0,
      maxUtilizationBps: 9500,
      maxDeviationBps: 1000, // +/-10% per update
      maxMovePerTx: 500n * E18,
      maxStaleness: DAY,
    };

    const rc = await (await factory.createVault(params)).wait();
    const ev = rc.logs
      .map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } })
      .find((e) => e && e.name === "VaultCreated");
    const vault = Vault.attach(ev.args.vault);

    for (const u of [alice, bob, attacker]) {
      await weth.mint(u.address, 100000n * E18);
      await weth.connect(u).approve(await vault.getAddress(), ethers.MaxUint256);
    }

    return { weth, impl, factory, vault, params, Vault,
      deployer, admin, keeper, guardian, feeRecipient, alice, bob, attacker, strategyTarget };
  }

  // ------------------------------------------------------------------ deposits

  describe("deposit", function () {
    it("mints shares 1:1 (scaled by decimals offset) on first deposit", async function () {
      const { vault, alice } = await loadFixture(deployFixture);
      await expect(vault.connect(alice).deposit(100n * E18))
        .to.emit(vault, "Deposited");
      expect(await vault.decimals()).to.equal(21); // 18 + offset 3
      expect(await vault.balanceOf(alice.address)).to.be.closeTo(100n * E18 * 1000n, 10n ** 6n);
      expect(await vault.totalAssets()).to.equal(100n * E18);
      expect(await vault.pricePerShare()).to.be.closeTo(E18, 10n ** 6n);
    });

    it("enforces zero-amount, minDeposit and depositCap", async function () {
      const { vault, admin, alice } = await loadFixture(deployFixture);
      await expect(vault.connect(alice).deposit(0)).to.be.revertedWithCustomError(vault, "ZeroAmount");
      await vault.connect(admin).setCaps(100n * E18, E18);
      await expect(vault.connect(alice).deposit(E18 / 2n)).to.be.revertedWithCustomError(vault, "BelowMinDeposit");
      await vault.connect(alice).deposit(60n * E18);
      await expect(vault.connect(alice).deposit(50n * E18)).to.be.revertedWithCustomError(vault, "DepositCapExceeded");
      await vault.connect(alice).deposit(40n * E18); // exactly at cap
    });

    it("mints proportional shares for later depositors after price appreciation", async function () {
      const { vault, weth, alice, bob } = await loadFixture(deployFixture);
      await vault.connect(alice).deposit(100n * E18);
      await weth.mint(await vault.getAddress(), 100n * E18); // 2x price via donated yield
      await vault.connect(bob).deposit(100n * E18);
      // bob should get ~half of alice's shares
      const a = await vault.balanceOf(alice.address);
      const b = await vault.balanceOf(bob.address);
      expect(b).to.be.closeTo(a / 2n, a / 1000n);
    });
  });

  // ------------------------------------------------------------------ inflation attack

  describe("first-depositor / inflation attack", function () {
    it("makes donation attacks strictly unprofitable (virtual shares offset)", async function () {
      const { vault, weth, attacker, alice, keeper } = await loadFixture(deployFixture);
      // attacker front-runs with dust then donates to inflate the share price
      await vault.connect(attacker).deposit(1n);
      const donation = 500n * E18;
      await weth.connect(attacker).transfer(await vault.getAddress(), donation);

      await vault.connect(alice).deposit(10n * E18);

      // attacker exits: total redeemable is far below the 500 WETH+1 wei they spent
      const attackerShares = await vault.balanceOf(attacker.address);
      const attackerValue = await vault.convertToAssets(attackerShares);
      const attackerLoss = donation + 1n - attackerValue;
      expect(attackerValue).to.be.lt(donation); // strictly loses money
      // attacker burns far more than the victim could possibly lose (whole deposit = 10)
      expect(attackerLoss).to.be.gt(10n * E18 * 10n); // loses >100x victim's max loss
      const victimValue = await vault.convertToAssets(await vault.balanceOf(alice.address));
      expect(attackerLoss).to.be.gt(10n * E18 - victimValue); // grief costs exceed damage
    });

    it("caps victim loss to dust in realistic donation scenarios", async function () {
      const { vault, weth, attacker, alice } = await loadFixture(deployFixture);
      await vault.connect(attacker).deposit(1n);
      await weth.connect(attacker).transfer(await vault.getAddress(), 1n * E18);
      await vault.connect(alice).deposit(10n * E18);
      const aliceValue = await vault.convertToAssets(await vault.balanceOf(alice.address));
      // alice keeps >= 99% of her deposit
      expect(aliceValue).to.be.gte((10n * E18 * 99n) / 100n);
    });
  });

  // ------------------------------------------------------------------ withdrawal queue

  describe("withdrawal queue", function () {
    it("runs the full lifecycle: request -> process -> claim", async function () {
      const { vault, weth, alice, keeper } = await loadFixture(deployFixture);
      await vault.connect(alice).deposit(100n * E18);
      const half = (await vault.balanceOf(alice.address)) / 2n;

      await expect(vault.connect(alice).requestWithdraw(half))
        .to.emit(vault, "WithdrawRequested").withArgs(alice.address, 0, half);
      expect(await vault.balanceOf(await vault.getAddress())).to.equal(half); // escrowed
      expect(await vault.pendingWithdrawals()).to.equal(1);

      await expect(vault.connect(keeper).processWithdrawals(10))
        .to.emit(vault, "WithdrawProcessed");
      const owed = await vault.claimable(alice.address);
      expect(owed).to.be.closeTo(50n * E18, E18 / 100n);
      expect(await vault.pendingWithdrawals()).to.equal(0);
      // reserved assets excluded from totalAssets
      expect(await vault.totalAssets()).to.be.closeTo(50n * E18, E18 / 100n);

      const before = await weth.balanceOf(alice.address);
      await expect(vault.connect(alice).claim()).to.emit(vault, "Claimed").withArgs(alice.address, owed);
      expect((await weth.balanceOf(alice.address)) - before).to.equal(owed);
      expect(await vault.claimable(alice.address)).to.equal(0);
      await expect(vault.connect(alice).claim()).to.be.revertedWithCustomError(vault, "NothingToClaim");
    });

    it("reverts on zero-share request and insufficient share balance", async function () {
      const { vault, alice } = await loadFixture(deployFixture);
      await expect(vault.connect(alice).requestWithdraw(0)).to.be.revertedWithCustomError(vault, "ZeroAmount");
      await expect(vault.connect(alice).requestWithdraw(1n)).to.be.reverted; // ERC20InsufficientBalance
    });

    it("stops (not reverts) at illiquid requests and resumes FIFO after collateral returns", async function () {
      const { vault, weth, alice, bob, keeper, strategyTarget } = await loadFixture(deployFixture);
      await vault.connect(alice).deposit(50n * E18);
      await vault.connect(bob).deposit(50n * E18);
      await vault.connect(keeper).moveToStrategy(95n * E18); // 5 liquid left

      await vault.connect(alice).requestWithdraw(await vault.balanceOf(alice.address)); // ~50, illiquid
      await vault.connect(bob).requestWithdraw(await vault.balanceOf(bob.address));
      expect(await vault.connect(keeper).processWithdrawals.staticCall(10)).to.equal(0);

      // strategy unwinds: bridge returns funds, keeper books them
      await weth.connect(strategyTarget).transfer(await vault.getAddress(), 95n * E18);
      await vault.connect(keeper).returnFromStrategy(95n * E18);

      await vault.connect(keeper).processWithdrawals(10);
      expect(await vault.claimable(alice.address)).to.be.closeTo(50n * E18, E18 / 100n);
      expect(await vault.claimable(bob.address)).to.be.closeTo(50n * E18, E18 / 100n);
    });

    it("processes only up to maxItems, FIFO", async function () {
      const { vault, alice, bob, keeper } = await loadFixture(deployFixture);
      await vault.connect(alice).deposit(10n * E18);
      await vault.connect(bob).deposit(10n * E18);
      await vault.connect(alice).requestWithdraw(await vault.balanceOf(alice.address));
      await vault.connect(bob).requestWithdraw(await vault.balanceOf(bob.address));
      await vault.connect(keeper).processWithdrawals(1);
      expect(await vault.claimable(alice.address)).to.be.gt(0);
      expect(await vault.claimable(bob.address)).to.equal(0);
      expect(await vault.pendingWithdrawals()).to.equal(1);
    });
  });

  // ------------------------------------------------------------------ strategy accounting

  describe("strategy value & movement", function () {
    it("moveToStrategy transfers to target and books principal; caps enforced", async function () {
      const { vault, weth, keeper, strategyTarget, admin, alice } = await loadFixture(deployFixture);
      await vault.connect(alice).deposit(100n * E18);

      // utilization cap 95%
      await expect(vault.connect(keeper).moveToStrategy(96n * E18))
        .to.be.revertedWithCustomError(vault, "UtilizationCapExceeded");
      await expect(vault.connect(keeper).moveToStrategy(50n * E18))
        .to.emit(vault, "MovedToStrategy").withArgs(strategyTarget.address, 50n * E18);
      expect(await weth.balanceOf(strategyTarget.address)).to.equal(50n * E18);
      expect(await vault.strategyValue()).to.equal(50n * E18);
      expect(await vault.totalAssets()).to.equal(100n * E18); // unchanged: principal booked

      // per-tx cap
      await vault.connect(admin).setStrategyParams(strategyTarget.address, 9500, 1000, 10n * E18, DAY);
      await expect(vault.connect(keeper).moveToStrategy(11n * E18))
        .to.be.revertedWithCustomError(vault, "PerTxCapExceeded");
      await expect(vault.connect(keeper).moveToStrategy(0)).to.be.revertedWithCustomError(vault, "ZeroAmount");
      await expect(vault.connect(keeper).moveToStrategy(51n * E18)).to.be.reverted; // > liquid & > per-tx
    });

    it("updateStrategyValue enforces the deviation guard and timestamp sanity", async function () {
      const { vault, alice, keeper } = await loadFixture(deployFixture);
      await vault.connect(alice).deposit(100n * E18);
      await vault.connect(keeper).moveToStrategy(50n * E18);

      let ts = await time.latest();
      await expect(vault.connect(keeper).updateStrategyValue(56n * E18, ts))
        .to.be.revertedWithCustomError(vault, "DeviationExceeded"); // +12% > 10%
      await expect(vault.connect(keeper).updateStrategyValue(44n * E18, ts))
        .to.be.revertedWithCustomError(vault, "DeviationExceeded"); // -12%
      await expect(vault.connect(keeper).updateStrategyValue(55n * E18, ts + 10000))
        .to.be.revertedWithCustomError(vault, "InvalidTimestamp"); // future
      await expect(vault.connect(keeper).updateStrategyValue(55n * E18, 1))
        .to.be.revertedWithCustomError(vault, "InvalidTimestamp"); // older than last report

      await expect(vault.connect(keeper).updateStrategyValue(55n * E18, ts))
        .to.emit(vault, "StrategyValueUpdated").withArgs(50n * E18, 55n * E18, ts);
      expect(await vault.totalAssets()).to.equal(105n * E18); // premium PnL reflected
    });

    it("blocks deposits and processing when the report is stale, until refreshed", async function () {
      const { vault, alice, keeper } = await loadFixture(deployFixture);
      await vault.connect(alice).deposit(100n * E18);
      await vault.connect(keeper).moveToStrategy(50n * E18);
      await time.increase(2 * DAY);

      await expect(vault.connect(alice).deposit(E18)).to.be.revertedWithCustomError(vault, "StaleStrategyValue");
      await expect(vault.connect(keeper).processWithdrawals(1))
        .to.be.revertedWithCustomError(vault, "StaleStrategyValue");

      await vault.connect(keeper).updateStrategyValue(50n * E18, await time.latest());
      await vault.connect(alice).deposit(E18); // fresh again
    });

    it("returnFromStrategy decrements booked value and rejects over-returns", async function () {
      const { vault, weth, alice, keeper, strategyTarget } = await loadFixture(deployFixture);
      await vault.connect(alice).deposit(100n * E18);
      await vault.connect(keeper).moveToStrategy(50n * E18);
      await expect(vault.connect(keeper).returnFromStrategy(51n * E18))
        .to.be.revertedWithCustomError(vault, "InsufficientStrategyValue");
      await weth.connect(strategyTarget).transfer(await vault.getAddress(), 20n * E18);
      await expect(vault.connect(keeper).returnFromStrategy(20n * E18))
        .to.emit(vault, "ReturnedFromStrategy").withArgs(20n * E18);
      expect(await vault.strategyValue()).to.equal(30n * E18);
      expect(await vault.totalAssets()).to.equal(100n * E18);
    });

    it("admin forceStrategyValue bypasses the deviation guard (liquidation recovery)", async function () {
      const { vault, alice, keeper, admin } = await loadFixture(deployFixture);
      await vault.connect(alice).deposit(100n * E18);
      await vault.connect(keeper).moveToStrategy(50n * E18);
      await expect(vault.connect(keeper).forceStrategyValue(0)).to.be.reverted; // admin only
      await vault.connect(admin).forceStrategyValue(10n * E18);
      expect(await vault.strategyValue()).to.equal(10n * E18);
      expect(await vault.totalAssets()).to.equal(60n * E18);
    });
  });

  // ------------------------------------------------------------------ fees

  describe("fees", function () {
    it("accrues management fee as share dilution over time", async function () {
      const { vault, admin, alice, keeper, feeRecipient } = await loadFixture(deployFixture);
      await vault.connect(admin).setFees(200, 0, feeRecipient.address); // 2%/yr
      await vault.connect(alice).deposit(100n * E18);
      await time.increase(YEAR);
      await vault.connect(keeper).updateStrategyValue(0, await time.latest()); // triggers accrual

      const feeShares = await vault.balanceOf(feeRecipient.address);
      const feeValue = await vault.convertToAssets(feeShares);
      expect(feeValue).to.be.closeTo(2n * E18, E18 / 50n); // ~2 WETH of the 100
      // alice diluted accordingly
      const aliceValue = await vault.convertToAssets(await vault.balanceOf(alice.address));
      expect(aliceValue).to.be.closeTo(98n * E18, E18 / 50n);
    });

    it("charges performance fee only above the high-water mark, then ratchets it", async function () {
      const { vault, weth, admin, alice, keeper, feeRecipient } = await loadFixture(deployFixture);
      await vault.connect(admin).setFees(0, 2000, feeRecipient.address); // 20% perf
      await vault.connect(alice).deposit(100n * E18);

      await weth.mint(await vault.getAddress(), 10n * E18); // +10% strategy profit
      await expect(vault.connect(keeper).updateStrategyValue(0, await time.latest()))
        .to.emit(vault, "FeesAccrued");
      const feeValue = await vault.convertToAssets(await vault.balanceOf(feeRecipient.address));
      expect(feeValue).to.be.closeTo(2n * E18, E18 / 50n); // 20% of 10

      const hwm = await vault.highWaterMark();
      expect(hwm).to.equal(await vault.pricePerShare()); // post-fee ratchet

      // no double-charge without new profit
      const before = await vault.balanceOf(feeRecipient.address);
      await vault.connect(keeper).updateStrategyValue(0, await time.latest());
      expect(await vault.balanceOf(feeRecipient.address)).to.equal(before);

      // price below HWM => still no perf fee
      await vault.connect(admin).forceStrategyValue(0);
      await vault.connect(keeper).updateStrategyValue(0, await time.latest());
      expect(await vault.balanceOf(feeRecipient.address)).to.equal(before);
    });

    it("enforces hard fee caps at init and in setFees", async function () {
      const { vault, factory, impl, admin, params, feeRecipient } = await loadFixture(deployFixture);
      await expect(vault.connect(admin).setFees(201, 0, feeRecipient.address))
        .to.be.revertedWithCustomError(vault, "FeeCapExceeded");
      await expect(vault.connect(admin).setFees(0, 3001, feeRecipient.address))
        .to.be.revertedWithCustomError(vault, "FeeCapExceeded");
      await expect(vault.connect(admin).setFees(0, 0, ethers.ZeroAddress))
        .to.be.revertedWithCustomError(vault, "ZeroAddress");
      await expect(factory.createVault({ ...params, mgmtFeeBps: 300 }))
        .to.be.revertedWithCustomError(impl, "FeeCapExceeded");
    });
  });

  // ------------------------------------------------------------------ roles & pause

  describe("roles, pause, upgrade", function () {
    it("gates keeper functions", async function () {
      const { vault, alice } = await loadFixture(deployFixture);
      for (const call of [
        vault.connect(alice).moveToStrategy(1),
        vault.connect(alice).returnFromStrategy(1),
        vault.connect(alice).updateStrategyValue(1, 1),
        vault.connect(alice).processWithdrawals(1),
      ]) {
        await expect(call).to.be.revertedWithCustomError(vault, "AccessControlUnauthorizedAccount");
      }
    });

    it("gates admin functions", async function () {
      const { vault, alice, keeper, strategyTarget } = await loadFixture(deployFixture);
      for (const call of [
        vault.connect(keeper).setCaps(1, 1),
        vault.connect(keeper).setFees(1, 1, alice.address),
        vault.connect(keeper).setStrategyParams(strategyTarget.address, 1, 1, 1, 1),
        vault.connect(keeper).unpause(),
      ]) {
        await expect(call).to.be.revertedWithCustomError(vault, "AccessControlUnauthorizedAccount");
      }
    });

    it("guardian pauses instantly; only admin unpauses; queue exit still works", async function () {
      const { vault, weth, alice, keeper, guardian, admin } = await loadFixture(deployFixture);
      await vault.connect(alice).deposit(10n * E18);
      await expect(vault.connect(alice).pause()).to.be.revertedWithCustomError(vault, "AccessControlUnauthorizedAccount");
      await vault.connect(guardian).pause();

      await expect(vault.connect(alice).deposit(E18)).to.be.revertedWithCustomError(vault, "EnforcedPause");
      await expect(vault.connect(keeper).moveToStrategy(E18)).to.be.revertedWithCustomError(vault, "EnforcedPause");

      // exits remain live while paused
      await vault.connect(alice).requestWithdraw(await vault.balanceOf(alice.address));
      await vault.connect(keeper).processWithdrawals(1);
      await vault.connect(alice).claim();

      await expect(vault.connect(guardian).unpause()).to.be.revertedWithCustomError(vault, "AccessControlUnauthorizedAccount");
      await vault.connect(admin).unpause();
      await vault.connect(alice).deposit(E18);
    });

    it("restricts UUPS upgrades to the admin and preserves state", async function () {
      const { vault, Vault, alice, admin } = await loadFixture(deployFixture);
      await vault.connect(alice).deposit(10n * E18);
      const newImpl = await Vault.deploy();
      await expect(vault.connect(alice).upgradeToAndCall(await newImpl.getAddress(), "0x"))
        .to.be.revertedWithCustomError(vault, "AccessControlUnauthorizedAccount");
      await vault.connect(admin).upgradeToAndCall(await newImpl.getAddress(), "0x");
      expect(await vault.totalAssets()).to.equal(10n * E18); // state intact
    });

    it("cannot be re-initialized (proxy or implementation)", async function () {
      const { vault, impl, params } = await loadFixture(deployFixture);
      await expect(vault.initialize(params)).to.be.revertedWithCustomError(vault, "InvalidInitialization");
      await expect(impl.initialize(params)).to.be.revertedWithCustomError(impl, "InvalidInitialization");
    });
  });

  // ------------------------------------------------------------------ 4626-style views

  describe("ERC-4626-style views", function () {
    it("convertToShares/convertToAssets round-trip within rounding", async function () {
      const { vault, alice } = await loadFixture(deployFixture);
      await vault.connect(alice).deposit(123n * E18);
      const shares = await vault.convertToShares(7n * E18);
      const back = await vault.convertToAssets(shares);
      expect(back).to.be.closeTo(7n * E18, 10n ** 6n);
      expect(await vault.asset()).to.not.equal(ethers.ZeroAddress);
    });
  });

  // ------------------------------------------------------------------ factory

  describe("VaultFactory", function () {
    it("only owner deploys; registry is tracked; implementation is swappable", async function () {
      const { factory, params, alice, weth, deployer } = await loadFixture(deployFixture);
      await expect(factory.connect(alice).createVault(params))
        .to.be.revertedWithCustomError(factory, "OwnableUnauthorizedAccount");

      expect(await factory.vaultCount()).to.equal(1);
      const v0 = await factory.allVaults(0);
      expect(await factory.isVault(v0)).to.equal(true);
      expect(await factory.vaultsByAsset(await weth.getAddress(), 0)).to.equal(v0);

      await expect(factory.connect(deployer).createVault(params)).to.emit(factory, "VaultCreated");
      expect(await factory.vaultCount()).to.equal(2);

      await expect(factory.setImplementation(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(factory, "ZeroAddress");
      const Vault = await ethers.getContractFactory("OverwriteVault");
      const impl2 = await Vault.deploy();
      await expect(factory.setImplementation(await impl2.getAddress()))
        .to.emit(factory, "ImplementationSet").withArgs(await impl2.getAddress());
    });

    it("initializes vault metadata through the proxy", async function () {
      const { vault, weth } = await loadFixture(deployFixture);
      expect(await vault.name()).to.equal("Overwrite WETH Covered Call");
      expect(await vault.symbol()).to.equal("owWETH");
      expect(await vault.asset()).to.equal(await weth.getAddress());
    });
  });
});
