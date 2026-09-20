/**
 * 체인별 DEX·USDT 주소 (2026-09-07 PancakeSwap 개발자 문서 기준).
 * 스크립트는 실행 전 각 주소에 코드가 있는지 확인한다(preflight / lib.assertContract).
 *
 * fee: 풀 수수료 basis points (PancakeSwap v2 = 25, Uniswap v2 사본 = 30)
 */
module.exports = {
  56: {
    name: "BSC mainnet",
    router: "0x10ED43C718714eb63d5aA57B78B54704E256024E",
    factory: "0xcA143Ce32Fe78f1f7019d7d551a6402fC5350c73",
    usdt: "0x55d398326f99059fF775485246999027B3197955", // BSC-USD, 18 decimals
    whale: "0xF977814e90dA44bFA03b6295A0616a897441aceC", // 포크에서 USDT 조달용(잔고는 스크립트가 확인)
    fee: 25,
  },
  97: {
    name: "BSC testnet",
    router: "0xD99D1c33F9fC3444f8101754aBC46c52416550D1",
    factory: "0x6725F303b657a9451d8BA641348b6761A6CC7a17",
    usdt: "", // 정식 USDT 없음 → deploy-mock-usdt.js
    fee: 25,
  },
  204: {
    name: "opBNB mainnet",
    router: "0x8cFe327CEc66d1C090Dd72bd0FF11d690C33a2Eb",
    factory: "0x02a84c1b3BBD7401a5f7fa98a384EBC70bB5749E",
    usdt: "0x9e5AAC1Ba1a2e6aEd6b32689DFcF62A509Ca96f3", // 브리지 USDT (배포 전 opBNBScan 에서 재확인)
    fee: 25,
  },
  5611: {
    name: "opBNB testnet",
    router: "", // PancakeSwap 미배포 → deploy-local-dex.js 로 v2 사본 배포
    factory: "",
    usdt: "",
    fee: 30,
  },
  31337: {
    name: "hardhat/localhost",
    router: "",
    factory: "",
    usdt: "",
    fee: 30,
  },
};
