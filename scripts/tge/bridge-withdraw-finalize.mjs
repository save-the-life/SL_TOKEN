/**
 * (S3-b ③) opBNB → BSC 출금의 prove / finalize (OP Stack 표준 절차, viem op-stack)
 *
 *   node scripts/tge/bridge-withdraw-finalize.mjs <opBNB 출금 tx 해시>
 *
 * 순서: L2 영수증 → 출력 루트 게시 대기(waitToProve) → proveWithdrawal(BSC) → 챌린지 기간 대기(waitToFinalize)
 *       → finalizeWithdrawal(BSC) → L1 표현 토큰 잔고 확인.
 * 테스트넷 챌린지 기간은 수 초, 메인넷은 7일이다(메인넷은 prove 뒤 7일 후 다시 실행).
 * .env 의 PRIVATE_KEY / BSC_TESTNET_RPC / OPBNB_RPC 를 쓴다.
 */
import "dotenv/config";
import fs from "node:fs";
import { createPublicClient, createWalletClient, http, defineChain, formatUnits, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";
import { publicActionsL1, publicActionsL2, walletActionsL1 } from "viem/op-stack";

const L1_RPC = process.env.BSC_TESTNET_RPC || "https://bsc-testnet-rpc.publicnode.com";
const L2_RPC = process.env.OPBNB_RPC || "https://opbnb-testnet-rpc.bnbchain.org";

// opBNB 테스트넷 — L1(BSC 97) 쪽 컨트랙트를 명시 (docs.bnbchain.org opBNB protocol addresses)
const opBNBTestnet = defineChain({
  id: 5611,
  name: "opBNB Testnet",
  nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
  rpcUrls: { default: { http: [L2_RPC] } },
  sourceId: 97,
  contracts: {
    l2OutputOracle: { 97: { address: "0xFf2394Bb843012562f4349C6632a0EcB92fC8810" } },
    portal: { 97: { address: "0x4386C8ABf2009aC0c263462Da568DD9d46e52a31" } },
    l1StandardBridge: { 97: { address: "0x677311Fd2cCc511Bbc0f581E8d9a07B033D5E840" } },
  },
});

const hash = process.argv[2];
if (!hash || !/^0x[0-9a-fA-F]{64}$/.test(hash)) { console.error("사용법: node scripts/tge/bridge-withdraw-finalize.mjs <opBNB 출금 tx 해시>"); process.exit(1); }
const account = privateKeyToAccount(process.env.PRIVATE_KEY);

const l1 = createPublicClient({ chain: bscTestnet, transport: http(L1_RPC) }).extend(publicActionsL1());
const l2 = createPublicClient({ chain: opBNBTestnet, transport: http(L2_RPC) }).extend(publicActionsL2());
const wallet = createWalletClient({ account, chain: bscTestnet, transport: http(L1_RPC) }).extend(walletActionsL1());

const receipt = await l2.getTransactionReceipt({ hash });
console.log(`L2 출금 tx ${hash}  block ${receipt.blockNumber}  status ${receipt.status}`);

const status0 = await l1.getWithdrawalStatus({ receipt, targetChain: opBNBTestnet });
console.log("현재 상태:", status0);

let withdrawal;
if (status0 === "ready-to-prove" || status0 === "waiting-to-prove") {
  console.log("출력 루트 게시 대기 중 (waitToProve)…");
  const { output, withdrawal: w } = await l1.waitToProve({ receipt, targetChain: opBNBTestnet });
  withdrawal = w;
  const args = await l2.buildProveWithdrawal({ output, withdrawal });
  const proveHash = await wallet.proveWithdrawal(args);
  console.log(`prove 전송  ${proveHash}`);
  const pr = await l1.waitForTransactionReceipt({ hash: proveHash });
  console.log(`prove 확정  block ${pr.blockNumber}  status ${pr.status}`);
} else {
  const [w] = await l2.getWithdrawals({ receipt }); // 이미 prove 됐거나 finalize 대기
  withdrawal = w;
}

const status1 = await l1.getWithdrawalStatus({ receipt, targetChain: opBNBTestnet });
console.log("prove 후 상태:", status1);
if (status1 === "finalized") { console.log("이미 finalize 됨"); }
else {
  console.log("챌린지 기간 대기 (waitToFinalize)…");
  await l1.waitToFinalize({ withdrawalHash: withdrawal.withdrawalHash, targetChain: opBNBTestnet });
  const finHash = await wallet.finalizeWithdrawal({ targetChain: opBNBTestnet, withdrawal });
  console.log(`finalize 전송  ${finHash}`);
  const fr = await l1.waitForTransactionReceipt({ hash: finHash });
  console.log(`finalize 확정  block ${fr.blockNumber}  status ${fr.status}`);
}

// L1 표현 토큰 잔고
try {
  const b = JSON.parse(fs.readFileSync(new URL("../../deployments/bridge.bscTestnet.json", import.meta.url)));
  const erc = parseAbi(["function balanceOf(address) view returns (uint256)", "function totalSupply() view returns (uint256)"]);
  const bal = await l1.readContract({ address: b.l1Token, abi: erc, functionName: "balanceOf", args: [account.address] });
  const sup = await l1.readContract({ address: b.l1Token, abi: erc, functionName: "totalSupply" });
  console.log(`✅ BSC 표현 토큰 ${b.l1Token}  내 잔고 ${formatUnits(bal, 18)} SL  총공급 ${formatUnits(sup, 18)}`);
} catch (e) { console.log("잔고 확인 생략:", e.message); }
