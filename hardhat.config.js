require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const accounts = PRIVATE_KEY ? [PRIVATE_KEY] : [];

// 포크 리허설: FORK_URL 이 있으면 in-process hardhat 네트워크가 해당 체인을 포크한다.
// (여러 스크립트에 걸쳐 상태를 유지하려면 `npx hardhat node --fork <url>` + `--network localhost` 를 쓸 것)
const hardhatNet = {};
if (process.env.FORK_URL) {
  hardhatNet.forking = { url: process.env.FORK_URL };
  if (process.env.FORK_BLOCK) hardhatNet.forking.blockNumber = Number(process.env.FORK_BLOCK);
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    // 로컬 테스트용 (기본)
    hardhat: hardhatNet,

    // `npx hardhat node` (포크 포함) 로 띄운 로컬 노드
    localhost: { url: "http://127.0.0.1:8545", chainId: 31337 },

    // opBNB 테스트넷
    opbnbTestnet: {
      url: process.env.OPBNB_RPC || "https://opbnb-testnet-rpc.bnbchain.org",
      chainId: 5611,
      accounts,
    },

    // BSC 테스트넷 — PancakeSwap 공식 테스트넷 배포가 있는 유일한 체인 (DEX 리허설용)
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC || "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
      chainId: 97,
      accounts,
    },

    // ⚠️ 메인넷(opBNB 204 · BSC 56)은 이 파일에 두지 않는다.
    //    메인넷 배포는 별도 설정 파일(hardhat.mainnet.config.js)을 --config 로 명시할 때만 가능하게 해서
    //    평소 명령이 실수로 메인넷을 고르지 못하게 한다.
  },
  // 컨트랙트 검증(opBNBScan/NodeReal, BscScan) 사용 시 설정
  etherscan: {
    apiKey: {
      opbnbTestnet: process.env.NODEREAL_API_KEY || "",
      bscTestnet: process.env.BSCSCAN_API_KEY || "",
    },
    customChains: [
      {
        network: "opbnbTestnet",
        chainId: 5611,
        urls: {
          apiURL:
            "https://open-platform.nodereal.io/" +
            (process.env.NODEREAL_API_KEY || "YOUR_KEY") +
            "/op-bnb-testnet/contract/",
          browserURL: "https://opbnb-testnet.bscscan.com/",
        },
      },
    ],
  },
};
