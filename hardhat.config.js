require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

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
    hardhat: {},

    // opBNB 테스트넷
    opbnbTestnet: {
      url: process.env.OPBNB_RPC || "https://opbnb-testnet-rpc.bnbchain.org",
      chainId: 5611,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      // opBNB는 가스가 매우 저렴. 필요시 gasPrice 조정.
    },
  },
  // 컨트랙트 검증(opBNBScan/NodeReal) 사용 시 설정
  etherscan: {
    apiKey: {
      opbnbTestnet: process.env.NODEREAL_API_KEY || "",
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
