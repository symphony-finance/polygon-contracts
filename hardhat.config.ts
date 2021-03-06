require('dotenv').config();
require("hardhat-gas-reporter");
require("@nomiclabs/hardhat-waffle");
require("@nomiclabs/hardhat-etherscan");
require('@openzeppelin/hardhat-upgrades');
const { accounts } = require('./test-accounts.ts');

const HARDFORK = 'london';
const DEFAULT_GAS_MUL = 5;
const GWEI = 1000 * 1000 * 1000;
const DEFAULT_BLOCK_GAS_LIMIT = 12450000;
const INFURA_KEY = process.env.INFURA_KEY || '';
const ALCHEMY_KEY = process.env.ALCHEMY_KEY || '';
const MAINNET_FORK = process.env.MAINNET_FORK === 'true';
const BUIDLEREVM_CHAINID = 31337;
const POLYGONSCAN_KEY = process.env.POLYGONSCAN_KEY || '';
const mainnetFork = MAINNET_FORK
    ? {
        blockNumber: 14335112,
        url: ALCHEMY_KEY
            ? `https://eth-mainnet.alchemyapi.io/v2/${ALCHEMY_KEY}`
            : `https://mainnet.infura.io/v3/${INFURA_KEY}`,
    }
    : undefined;

module.exports = {
    defaultNetwork: "localhost",
    networks: {
        localhost: {
            url: "http://127.0.0.1:8545",
            loggingEnabled: true,
        },
        hardhat: {
            hardfork: HARDFORK,
            blockGasLimit: DEFAULT_BLOCK_GAS_LIMIT,
            gas: DEFAULT_BLOCK_GAS_LIMIT,
            gasPrice: 8000000000,
            chainId: BUIDLEREVM_CHAINID,
            throwOnTransactionFailures: true,
            throwOnCallFailures: true,
            accounts: accounts.map(({ secretKey, balance }: { secretKey: string; balance: string }) => ({
                privateKey: secretKey,
                balance,
            })),
            forking: mainnetFork,
            loggingEnabled: true,
        },
        matic: {
            hardfork: HARDFORK,
            url: `https://polygon-rpc.com/`,
            accounts: [`0x${process.env.MAINNET_PRIVATE_KEY}`],
            chainId: 137,
            blockGasLimit: DEFAULT_BLOCK_GAS_LIMIT,
            gasPrice: 30 * GWEI
        },
        mumbai: {
            hardfork: HARDFORK,
            url: `https://rpc-mumbai.maticvigil.com`,
            accounts: [`0x${process.env.TESTNET_PRIVATE_KEY}`],
            chainId: 80001,
            gasPrice: 30 * GWEI
        },
        rinkeby: {
            url: `https://eth-rinkeby.alchemyapi.io/v2/${ALCHEMY_KEY}`,
            chainId: 4,
            accounts: [`0x${process.env.TESTNET_PRIVATE_KEY}`],
            blockGasLimit: DEFAULT_BLOCK_GAS_LIMIT,
        }
    },
    etherscan: {
        apiKey: POLYGONSCAN_KEY
    },
    solidity: {
        version: "0.8.10",
        settings: {
            optimizer: {
                enabled: true,
                runs: 200,
                details: {
                    yul: false
                },
            }
        }
    },
    paths: {
        sources: "./contracts",
        tests: "./test",
        cache: "./cache",
        artifacts: "./artifacts"
    },
    mocha: {
        timeout: 100000000
    }
}
