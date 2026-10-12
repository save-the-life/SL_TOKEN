/**
 * tBNB 를 BSC 테스트넷 → opBNB 테스트넷으로 공식 브리지(L1StandardBridge.depositETH)로 보낸다.
 * 브리지 UI 없이 스크립트로 처리해, faucet 만 사람이 받으면 나머지는 자동으로 끝난다.
 *
 *   BRIDGE_AMOUNT=0.1 npx hardhat run scripts/tge/bridge-deposit.js --network bscTestnet
 *
 * 입금(L1→L2)은 보통 수 분. 스크립트가 opBNB 테스트넷 잔고를 최대 WAIT_MIN(기본 15)분 동안 폴링한다.
 * 출금(L2→L1)은 7일 챌린지 기간이 있으므로 이 스크립트가 다루지 않는다.
 */
const hre = require("hardhat");
const { ethers } = hre;

const L1_STANDARD_BRIDGE = {
  97: "0x677311Fd2cCc511Bbc0f581E8d9a07B033D5E840", // BSC testnet → opBNB testnet
  56: "0xF05F0e4362859c3331Cb9395CBC201E3Fa6757Ea", // BSC mainnet → opBNB mainnet (이 스크립트에서는 사용 금지)
};
const L2_RPC = {
  97: process.env.OPBNB_RPC || "https://opbnb-testnet-rpc.bnbchain.org",
};
const ABI = ["function depositETH(uint32 _minGasLimit, bytes _extraData) payable"];

async function main() {
  const [signer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== 97) throw new Error("이 스크립트는 BSC 테스트넷(97)에서만 실행한다");
  const amount = ethers.parseEther(process.env.BRIDGE_AMOUNT || "0.1");
  const waitMin = Number(process.env.WAIT_MIN || 15);

  const l1Bal = await ethers.provider.getBalance(signer.address);
  console.log(`BSC 테스트넷 잔고: ${ethers.formatEther(l1Bal)} tBNB  (브리지 ${ethers.formatEther(amount)})`);
  if (l1Bal < amount + ethers.parseEther("0.01")) throw new Error("잔고 부족 — faucet 에서 tBNB 를 먼저 받으세요");

  const l2 = new ethers.JsonRpcProvider(L2_RPC[chainId]);
  const l2Before = await l2.getBalance(signer.address);
  console.log(`opBNB 테스트넷 잔고(전): ${ethers.formatEther(l2Before)}`);

  const bridge = new ethers.Contract(L1_STANDARD_BRIDGE[chainId], ABI, signer);
  const tx = await bridge.depositETH(200000, "0x", { value: amount });
  console.log(`depositETH 전송  tx ${tx.hash}`);
  const rc = await tx.wait();
  console.log(`L1 확정  block ${rc.blockNumber}  → opBNB 도착 대기 (최대 ${waitMin}분)`);

  const deadline = Date.now() + waitMin * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20000));
    const b = await l2.getBalance(signer.address);
    process.stdout.write(`  opBNB 잔고 ${ethers.formatEther(b)}\r`);
    if (b > l2Before) {
      console.log(`\n✅ 도착: opBNB 테스트넷 잔고 ${ethers.formatEther(b)} (+${ethers.formatEther(b - l2Before)})`);
      return;
    }
  }
  console.log("\n⚠️  아직 도착하지 않음 — 몇 분 뒤 preflight 로 잔고를 다시 확인하세요 (tx 는 L1 에서 확정됨)");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
