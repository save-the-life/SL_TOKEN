/**
 * (S3-b ③) 출금 진행 상태 확인 — L2 에스크로, L1 표현 토큰 공급량, L2OutputOracle 의 최신 게시 블록과 챌린지 창.
 *
 *   npx hardhat run scripts/tge/bridge-withdraw-status.js --network bscTestnet
 *
 * prove/finalize 자체는 OP Stack 표준 절차(viem op-stack 확장 또는 공식 브리지 UI 의 "Withdraw" 탭)로 진행한다.
 */
const hre = require("hardhat");
const { ethers } = hre;
const L = require("./lib");
const path = require("path");

const ORACLE = { 97: "0xFf2394Bb843012562f4349C6632a0EcB92fC8810" };
const ORACLE_ABI = ["function latestBlockNumber() view returns (uint256)", "function latestOutputIndex() view returns (uint256)", "function FINALIZATION_PERIOD_SECONDS() view returns (uint256)", "function SUBMISSION_INTERVAL() view returns (uint256)"];
const TOKEN_ABI = ["function totalSupply() view returns (uint256)", "function balanceOf(address) view returns (uint256)"];

async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== 97) throw new Error("BSC 테스트넷(97)에서 실행");
  const [signer] = await ethers.getSigners();
  const bfile = path.join(__dirname, "..", "..", "deployments", "bridge.bscTestnet.json");
  const ofile = path.join(__dirname, "..", "..", "deployments", "bridge.opbnbTestnet.json");
  const b = L.loadJson(bfile, {}), o = L.loadJson(ofile, { withdrawals: [] });
  if (!b.l1Token) throw new Error("bridge.bscTestnet.json 에 l1Token 없음");

  const t = new ethers.Contract(b.l1Token, TOKEN_ABI, ethers.provider);
  console.log(`L1 표현 토큰 ${b.l1Token}  supply ${ethers.formatUnits(await t.totalSupply(), 18)}  내 잔고 ${ethers.formatUnits(await t.balanceOf(signer.address), 18)}`);

  const oracle = new ethers.Contract(ORACLE[chainId], ORACLE_ABI, ethers.provider);
  const latestL2 = await oracle.latestBlockNumber();
  const fin = await oracle.FINALIZATION_PERIOD_SECONDS();
  console.log(`L2OutputOracle: 최신 게시 L2 블록 ${latestL2}  챌린지 기간 ${Number(fin) / 86400} 일  제출 간격 ${await oracle.SUBMISSION_INTERVAL()} 블록`);
  for (const w of o.withdrawals || []) {
    const posted = BigInt(w.block) <= latestL2;
    console.log(`- 출금 ${ethers.formatUnits(w.amount, 18)} SL  L2 block ${w.block}  tx ${w.tx}`);
    console.log(`  출력 루트 게시 ${posted ? "됨 → prove 가능" : "아직 (L2 블록 " + latestL2 + " 까지 게시)"}; finalize 는 prove 후 ${Number(fin) / 86400} 일`);
  }
  console.log("\nprove/finalize 방법: 공식 브리지 UI(opbnb-testnet-bridge.bnbchain.org → Withdraw → 해당 tx) 또는 viem op-stack: buildProveWithdrawal → proveWithdrawal → (7일) finalizeWithdrawal");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
