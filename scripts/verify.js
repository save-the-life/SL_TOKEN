/**
 * SL Token 배포 검증 스크립트 (읽기 전용 — 프라이빗키 불필요)
 *
 * 실행:
 *   npx hardhat run scripts/verify.js --network opbnbTestnet
 *
 * 하는 일:
 *   1) 배포된 SLToken/SLVesting을 읽어 총공급량·소각량·잔액 확인
 *   2) 각 베스팅 버킷의 "지금" 청구 가능량 출력
 *   3) vestedAmount(id, 미래시각) view를 이용해 TGE/3·6·12·13·24·48·60개월 시점의
 *      해제 비율(%)을 표로 출력 → 클리프/선형 동작을 한눈에 확인
 *
 * 주소 우선순위: 환경변수(TOKEN_ADDR/VESTING_ADDR) > deployments/<network>.json
 */
const hre = require("hardhat");
const { ethers } = hre;
const cfg = require("../config/allocations");
const fs = require("fs");
const path = require("path");

const MONTH = 30n * 24n * 60n * 60n;
const fmt = (wei) => Number(ethers.formatUnits(wei, 18)).toLocaleString(undefined, { maximumFractionDigits: 0 });

function loadAddresses() {
  if (process.env.TOKEN_ADDR && process.env.VESTING_ADDR) {
    return { token: process.env.TOKEN_ADDR, vesting: process.env.VESTING_ADDR };
  }
  const file = path.join(__dirname, "..", "deployments", `${hre.network.name}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  throw new Error(
    `배포 주소를 찾을 수 없습니다. deployments/${hre.network.name}.json 이 없으면 ` +
      `TOKEN_ADDR, VESTING_ADDR 환경변수로 지정하세요.`
  );
}

async function main() {
  const { token: TOKEN_ADDR, vesting: VESTING_ADDR } = loadAddresses();
  const provider = ethers.provider;

  const tokenAbi = (await hre.artifacts.readArtifact("SLToken")).abi;
  const vestingAbi = (await hre.artifacts.readArtifact("SLVesting")).abi;
  const token = new ethers.Contract(TOKEN_ADDR, tokenAbi, provider);
  const vesting = new ethers.Contract(VESTING_ADDR, vestingAbi, provider);

  console.log("네트워크:", hre.network.name);
  console.log("SLToken  :", TOKEN_ADDR);
  console.log("SLVesting:", VESTING_ADDR);

  // ── 1) 토큰 전체 상태 ──────────────────────────────
  const TOTAL = 2_000_000_000n * 10n ** 18n;
  const supply = await token.totalSupply();
  const burned = TOTAL - supply;
  const vestingBal = await token.balanceOf(VESTING_ADDR);
  console.log("\n=== 토큰 상태 ===");
  console.log(`총 발행(설계)   : ${fmt(TOTAL)} SL`);
  console.log(`현재 총공급량   : ${fmt(supply)} SL`);
  console.log(`소각됨          : ${fmt(burned)} SL  (Burn Reserve)`);
  console.log(`베스팅 컨트랙트 보유: ${fmt(vestingBal)} SL`);

  // ── 2) 현재 청구 가능량 + 스케줄 ───────────────────
  const block = await provider.getBlock("latest");
  const now = BigInt(block.timestamp);
  const vestingBuckets = cfg.buckets.filter((b) => b.type === "vesting");

  console.log("\n=== 각 베스팅 버킷 — 지금 청구 가능량 ===");
  const schedules = {};
  for (const b of vestingBuckets) {
    const id = ethers.id(b.key);
    const s = await vesting.schedules(id);
    schedules[b.key] = s; // start/total 등 보관
    const rel = await vesting.releasable(id);
    console.log(
      `${b.label.padEnd(22)} 총 ${fmt(s.total).padStart(13)} | 청구가능 ${fmt(rel).padStart(13)} | 누적수령 ${fmt(s.released)}`
    );
  }

  // ── 3) 미래 해제 비율 추이 (vestedAmount view 활용) ──
  const checkpoints = [
    ["TGE", 0n],
    ["3개월", 3n],
    ["6개월", 6n],
    ["12개월", 12n],
    ["13개월", 13n],
    ["24개월", 24n],
    ["48개월", 48n],
    ["60개월", 60n],
  ];

  // 헤더
  const header = "버킷".padEnd(22) + checkpoints.map(([n]) => n.padStart(7)).join("");
  console.log("\n=== 시점별 해제 비율(%) — 각 버킷 총량 대비 ===");
  console.log(header);
  console.log("-".repeat(header.length));

  for (const b of vestingBuckets) {
    const id = ethers.id(b.key);
    const s = schedules[b.key];
    const start = BigInt(s.start);
    const total = BigInt(s.total);
    let row = b.label.padEnd(22);
    for (const [, m] of checkpoints) {
      const t = start + m * MONTH;
      const vested = await vesting.vestedAmount(id, t);
      const pct = total === 0n ? 0 : Number((vested * 10000n) / total) / 100;
      row += `${pct.toFixed(1)}%`.padStart(7);
    }
    console.log(row);
  }

  console.log(
    "\n해석: Team은 12개월까지 0%, 13개월부터 오르기 시작해 48개월(12+36)에 100%.\n" +
      "      TGE 비율이 있는 버킷(노드세일·Marketing 등)은 TGE 열에서 이미 일부 해제됨."
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});