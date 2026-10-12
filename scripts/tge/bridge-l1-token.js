/**
 * (S3-b ①) opBNB 발행 토큰의 BSC 쪽 표현 토큰을 공식 L1 OptimismMintableERC20Factory 로 만든다.
 *
 *   L2_TOKEN=0x<opBNB SLToken> npx hardhat run scripts/tge/bridge-l1-token.js --network bscTestnet
 *
 * 결과 토큰은 L1StandardBridge 만 mint/burn 할 수 있는 표준 표현 토큰이며, remoteToken() 이 opBNB 토큰 주소를 가리킨다.
 * 기록: deployments/bridge.<network>.json
 */
const hre = require("hardhat");
const { ethers } = hre;
const L = require("./lib");
const fs = require("fs");
const path = require("path");

const FACTORY = {
  97: "0x1AD11eA5426bA3A11c0bA8c4B89fd1BCa732025E", // BSC testnet (opBNB testnet L1)
  56: "0x6560F2822c9dFb9801F5E9A7c7CE1564c8c2b461", // BSC mainnet (opBNB mainnet L1) — 이 스크립트에서는 사용 금지
};
const FACTORY_ABI = [
  "function BRIDGE() view returns (address)",
  "function createOptimismMintableERC20(address _remoteToken, string _name, string _symbol) returns (address)",
  "event OptimismMintableERC20Created(address indexed localToken, address indexed remoteToken, address deployer)",
];
const TOKEN_ABI = ["function remoteToken() view returns (address)", "function BRIDGE() view returns (address)", "function name() view returns (string)", "function symbol() view returns (string)", "function totalSupply() view returns (uint256)"];

async function main() {
  const [signer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== 97) throw new Error("이 스크립트는 BSC 테스트넷(97)에서만 실행한다 (메인넷은 별도 절차)");
  const l2Token = process.env.L2_TOKEN;
  if (!ethers.isAddress(l2Token)) throw new Error("L2_TOKEN(opBNB 토큰 주소) 필요");
  const name = process.env.L1_NAME || "SL Token (opBNB)";
  const symbol = process.env.L1_SYMBOL || "SL";

  const factory = new ethers.Contract(FACTORY[chainId], FACTORY_ABI, signer);
  await L.assertContract(FACTORY[chainId], "L1 factory");
  const bridge = await factory.BRIDGE();
  console.log(`L1 factory ${FACTORY[chainId]} → BRIDGE ${bridge}`);

  const predicted = await factory.createOptimismMintableERC20.staticCall(l2Token, name, symbol);
  const tx = await factory.createOptimismMintableERC20(l2Token, name, symbol);
  const rc = await tx.wait();
  let created = predicted;
  for (const log of rc.logs) {
    try { const p = factory.interface.parseLog(log); if (p && p.name === "OptimismMintableERC20Created") created = p.args.localToken; } catch {}
  }
  const t = new ethers.Contract(created, TOKEN_ABI, ethers.provider);
  console.log(`✅ L1 표현 토큰 생성  ${created}  tx ${rc.hash}`);
  console.log(`   name ${await t.name()} / ${await t.symbol()}  remoteToken ${await t.remoteToken()}  BRIDGE ${await t.BRIDGE()}  supply ${ethers.formatUnits(await t.totalSupply(), 18)}`);

  const file = path.join(__dirname, "..", "..", "deployments", `bridge.${hre.network.name}.json`);
  const prev = L.loadJson(file, {});
  L.saveJson(file, { ...prev, l1Factory: FACTORY[chainId], l1Bridge: bridge, l2Token, l1Token: created, createTx: rc.hash, createdAt: new Date().toISOString() });
  console.log(`저장: deployments/bridge.${hre.network.name}.json`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
