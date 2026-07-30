require("@nomicfoundation/hardhat-toolbox");

const { subtask } = require("hardhat/config");
const {
  TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD,
} = require("hardhat/builtin-tasks/task-names");

// Use the npm-packaged solc-js compiler (this build environment cannot reach
// binaries.soliditylang.org). Harmless elsewhere: it only intercepts 0.8.24.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (args.solcVersion === "0.8.24") {
    return {
      compilerPath: require.resolve("solc/soljson.js"),
      isSolcJs: true,
      version: args.solcVersion,
      longVersion: "0.8.24+commit.e11b9ed9",
    };
  }
  return runSuper(args);
});

/**
 * Overwrite — covered-call vault contracts for Derive Chain.
 *
 * Networks:
 *  - deriveMainnet: Derive Chain (OP-stack rollup), chain id 957.
 *  - deriveTestnet: Derive's Conduit testnet. RPC + chain id parameterized
 *    via env so the config survives Conduit endpoint rotations.
 *
 * Env vars:
 *  DERIVE_RPC_URL, DERIVE_TESTNET_RPC_URL, DERIVE_TESTNET_CHAIN_ID, DEPLOYER_PK
 */
const accounts = process.env.DEPLOYER_PK ? [process.env.DEPLOYER_PK] : [];

module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    deriveMainnet: {
      url: process.env.DERIVE_RPC_URL || "https://rpc.lyra.finance",
      chainId: 957,
      accounts,
    },
    deriveTestnet: {
      url: process.env.DERIVE_TESTNET_RPC_URL || "https://rpc-prod-testnet-0eakp60405.t.conduit.xyz",
      chainId: Number(process.env.DERIVE_TESTNET_CHAIN_ID || 901),
      accounts,
    },
  },
};
