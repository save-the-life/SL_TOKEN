/**
 * (S3-b ②) opBNB 테스트넷에서 SL 을 L2StandardBridge 에 맡기고 BSC 쪽 표현 토큰으로 출금을 시작한다.
 *
 *   L1_TOKEN=0x<BSC 표현 토큰> BRIDGE_SL=1000 npx hardhat run scripts/tge/bridge-withdraw-init.js --network opbnbTestnet
 *
 * L2 쪽에서는 토큰이 브리지에 에스크로되고(deposits[SL][L1token] 증가), 메시지가 L1 로 전달된다.
 * 실제 BSC 수령은 출력 루트 게시 + 7일 챌린지 기간 뒤 prove → finalize 가 필요하다 (bridge-withdraw-status.js 참고).
 */
const hre = require("hardhat");
const { ethers } = hre;
const L = require("./lib");
const fs = require("fs");
const path = require("path");

const L2_BRIDGE = "0x4200000000000000000000000000000000000010";
const BRIDGE_ABI = [
  "function OTHER_BRIDGE() view returns (address)",
  "function deposits(address,address) view returns (uint256)",
  "function bridgeERC20(address _localToken, address _remoteToken, uint256 _amount, uint32 _minGasLimit, bytes _extraData)",
  "event ERC20BridgeInitiated(address indexed localToken, address indexed remoteToken, address indexed from, address to, uint256 amount, bytes extraData)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== 5611) throw new Error("이 스크립트는 opBNB 테스트넷(5611)에서만 실행한다");
  const l1Token = process.env.L1_TOKEN;
  if (!ethers.isAddress(l1Token)) throw new Error("L1_TOKEN(BSC 표현 토큰 주소) 필요 — bridge-l1-token.js 결과");
  const dep = L.loadJson(L.files.deploy(), {});
  const slAddr = process.env.TOKEN_ADDR || dep.token;
  const amount = ethers.parseUnits(process.env.BRIDGE_SL || "1000", 18);

  const sl = new ethers.Contract(slAddr, L.ERC20_ABI, signer);
  const bridge = new ethers.Contract(L2_BRIDGE, BRIDGE_ABI, signer);
  console.log(`opBNB SL ${slAddr} → L2StandardBridge ${L2_BRIDGE} (OTHER_BRIDGE ${await bridge.OTHER_BRIDGE()})`);
  console.log(`  L1 표현 토큰 ${l1Token}  수량 ${ethers.formatUnits(amount, 18)} SL`);
  const bal = await sl.balanceOf(signer.address);
  if (bal < amount) throw new Error(`SL 잔고 부족 ${ethers.formatUnits(bal, 18)}`);

  const before = await bridge.deposits(slAddr, l1Token);
  await L.approveExact(slAddr, L2_BRIDGE, amount, signer);
  const tx = await bridge.bridgeERC20(slAddr, l1Token, amount, 200000, "0x");
  const rc = await tx.wait();
  const after = await bridge.deposits(slAddr, l1Token);
  await L.revoke(slAddr, L2_BRIDGE, signer);
  console.log(`✅ 출금 시작  tx ${rc.hash}  block ${rc.blockNumber}`);
  console.log(`   브리지 에스크로 deposits[SL][L1] ${ethers.formatUnits(before, 18)} → ${ethers.formatUnits(after, 18)}`);
  console.log(`   다음: 출력 루트 게시 후 7일 챌린지 → BSC 에서 prove/finalize (공식 브리지 UI 또는 bridge-withdraw-status.js 안내)`);

  const file = path.join(__dirname, "..", "..", "deployments", `bridge.${hre.network.name}.json`);
  const prev = L.loadJson(file, { withdrawals: [] });
  prev.withdrawals = prev.withdrawals || [];
  prev.withdrawals.push({ l2Token: slAddr, l1Token, amount: amount.toString(), tx: rc.hash, block: rc.blockNumber, initiatedAt: new Date().toISOString(), status: "initiated" });
  L.saveJson(file, prev);
  console.log(`저장: deployments/bridge.${hre.network.name}.json`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
