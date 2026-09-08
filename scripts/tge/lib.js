/**
 * TGE 리허설 스크립트 공용 헬퍼.
 *  - 파일 경로: deployments/<network>.json / .progress.json / .dex.json / .timelock.json / .timelock-ops.json
 *  - DEX 주소 해석: DEX=bsc|bsctest|opbnb|opbnbtest|local 환경변수 > chainId > deployments/<network>.dex.json
 */
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
const ADDR = require("./addresses");

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];
const FACTORY_ABI = [
  "function getPair(address,address) view returns (address)",
  "function createPair(address,address) returns (address)",
  "event PairCreated(address indexed token0, address indexed token1, address pair, uint256)",
];
const PAIR_ABI = [
  "function getReserves() view returns (uint112,uint112,uint32)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address,uint256) returns (bool)",
];
const ROUTER_ABI = [
  "function factory() view returns (address)",
  "function addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256) returns (uint256,uint256,uint256)",
  "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns (uint256[])",
  "function getAmountsOut(uint256,address[]) view returns (uint256[])",
];

const DEPLOY_DIR = path.join(__dirname, "..", "..", "deployments");
const file = (suffix) => path.join(DEPLOY_DIR, `${hre.network.name}${suffix}`);
const files = {
  deploy: () => file(".json"),
  progress: () => file(".progress.json"),
  dex: () => file(".dex.json"),
  timelock: () => file(".timelock.json"),
  ops: () => file(".timelock-ops.json"),
};
const loadJson = (f, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return fallback;
  }
};
const saveJson = (f, obj) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(obj, null, 2));
};
const mergeJson = (f, patch) => {
  const cur = loadJson(f, {});
  const next = { ...cur, ...patch };
  saveJson(f, next);
  return next;
};

function sqrtBig(n) {
  if (n < 0n) throw new Error("sqrt of negative");
  if (n < 2n) return n;
  let x0 = n;
  let x1 = (n >> 1n) + 1n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (x1 + n / x1) >> 1n;
  }
  return x0;
}

const fmt = (wei, dec = 18, digits = 4) =>
  Number(ethers.formatUnits(wei, dec)).toLocaleString("en-US", { maximumFractionDigits: digits });

/** USDT per SL (양쪽 decimals 반영) */
function priceOf(rSL, rUSDT, usdtDec = 18) {
  if (rSL === 0n) return 0;
  const num = rUSDT * 10n ** 18n * 10n ** BigInt(18 - usdtDec);
  return Number((num * 10n ** 18n) / rSL) / 1e36; // 1e18(scale) * 1e18(SL dec)
}

async function chainId() {
  return Number((await ethers.provider.getNetwork()).chainId);
}

async function assertContract(addr, label) {
  const code = await ethers.provider.getCode(addr);
  if (code === "0x") throw new Error(`${label} ${addr} 에 코드가 없습니다 (체인·주소 확인)`);
}

async function resolveDex() {
  const id = await chainId();
  const keyMap = { bsc: 56, bsctest: 97, opbnb: 204, opbnbtest: 5611, local: 31337 };
  const sel = process.env.DEX ? keyMap[process.env.DEX] : id;
  if (!sel) throw new Error(`DEX=${process.env.DEX} 인식 불가 (bsc|bsctest|opbnb|opbnbtest|local)`);
  const base = ADDR[sel] || {};
  const local = loadJson(files.dex(), {});
  const out = {
    chainId: id,
    selected: sel,
    name: base.name || "unknown",
    router: process.env.ROUTER_ADDR || base.router || local.router || "",
    factory: process.env.FACTORY_ADDR || base.factory || local.factory || "",
    usdt: process.env.USDT_ADDR || local.usdt || base.usdt || "",
    feeBps: Number(process.env.DEX_FEE_BPS || local.fee || base.fee || 25),
    whale: base.whale || "",
  };
  if (!out.router || !out.factory) {
    throw new Error(
      `이 네트워크(${out.name}, chainId ${id})에는 DEX 주소가 없습니다. ` +
        `deploy-local-dex.js 로 v2 사본을 배포하거나, 포크라면 DEX=bsc 처럼 지정하세요.`
    );
  }
  if (!out.usdt) throw new Error("USDT 주소 없음 — deploy-mock-usdt.js 실행 또는 USDT_ADDR 지정");
  await assertContract(out.router, "router");
  await assertContract(out.factory, "factory");
  await assertContract(out.usdt, "usdt");
  return out;
}

function tokenAddress() {
  const a = process.env.TOKEN_ADDR || loadJson(files.deploy(), {}).token;
  if (!a) throw new Error("TOKEN_ADDR 환경변수 또는 deployments/<network>.json 이 필요합니다");
  return a;
}

async function pairInfo(dex, tokenAddr, runner) {
  const factory = new ethers.Contract(dex.factory, FACTORY_ABI, runner);
  const pairAddr = await factory.getPair(tokenAddr, dex.usdt);
  if (pairAddr === ethers.ZeroAddress) return { exists: false, pairAddr, rSL: 0n, rUSDT: 0n };
  const pair = new ethers.Contract(pairAddr, PAIR_ABI, runner);
  const [r0, r1] = await pair.getReserves();
  const t0 = (await pair.token0()).toLowerCase();
  const isSL0 = t0 === tokenAddr.toLowerCase();
  return { exists: true, pairAddr, pair, rSL: isSL0 ? r0 : r1, rUSDT: isSL0 ? r1 : r0 };
}

async function approveExact(tokenAddr, spender, amount, signer) {
  const c = new ethers.Contract(tokenAddr, ERC20_ABI, signer);
  const tx = await c.approve(spender, amount);
  await tx.wait();
  return tx.hash;
}

async function revoke(tokenAddr, spender, signer) {
  const c = new ethers.Contract(tokenAddr, ERC20_ABI, signer);
  const cur = await c.allowance(signer.address, spender);
  if (cur > 0n) await (await c.approve(spender, 0)).wait();
  return cur;
}

async function deadline(secs = 1200) {
  const b = await ethers.provider.getBlock("latest");
  return BigInt(b.timestamp + secs);
}

const MONTH = 30n * 24n * 60n * 60n;

module.exports = {
  ERC20_ABI,
  FACTORY_ABI,
  PAIR_ABI,
  ROUTER_ABI,
  files,
  loadJson,
  saveJson,
  mergeJson,
  sqrtBig,
  fmt,
  priceOf,
  chainId,
  assertContract,
  resolveDex,
  tokenAddress,
  pairInfo,
  approveExact,
  revoke,
  deadline,
  MONTH,
};
