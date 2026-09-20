/**
 * (로컬/포크 전용) 시간 이동으로 베스팅·타임락·LP 락을 검증한다. 실제 테스트넷에서는 실행되지 않는다.
 *
 *   npx hardhat run scripts/tge/timetravel-check.js --network localhost
 *
 *   TGE+1일   : Marketing(TGE 20%)·Treasury(TGE 3%) releasable > 0, 나머지 0. Marketing release() 실행 → 잔고 증가.
 *   +6개월    : Treasury 클리프 종료. 예약된 타임락 작업(있으면) 실행 가능 → execute.
 *   +12/13/18/24개월 : 클리프 경계 확인. 24개월에 LP 락 해제 가능(isOperationReady) 확인.
 *
 * 주의: 체인 시각을 미래로 옮기므로 이후 같은 노드에서 새 스케줄 생성(start ≥ now)은 실패한다. 마지막에 실행할 것.
 */
const hre = require("hardhat");
const { ethers } = hre;
const cfg = require("../../config/allocations");
const L = require("./lib");

async function warpTo(ts) {
  await hre.network.provider.send("evm_setNextBlockTimestamp", [Number(ts)]);
  await hre.network.provider.send("evm_mine");
}

async function main() {
  const cid = await L.chainId();
  if (cid !== 31337) throw new Error("로컬/포크(chainId 31337)에서만 실행");
  const dep = L.loadJson(L.files.deploy(), {});
  const vesting = await ethers.getContractAt("SLVesting", dep.vesting);
  const token = await ethers.getContractAt("SLToken", dep.token);
  const tge = BigInt(dep.tge);
  const buckets = cfg.buckets.filter((b) => b.type === "vesting");
  const tl = L.loadJson(L.files.timelock(), {});
  const ops = L.loadJson(L.files.ops(), { ops: [] });
  const dex = L.loadJson(L.files.dex(), {});
  let ok = true;

  const table = async (label) => {
    console.log(`\n[${label}]`);
    const out = {};
    for (const b of buckets) {
      const id = ethers.id(b.key);
      const rel = await vesting.releasable(id);
      out[b.key] = rel;
      console.log(`  ${b.key.padEnd(12)} releasable ${L.fmt(rel).padStart(16)}`);
    }
    return out;
  };

  // TGE + 1일
  await warpTo(tge + 86400n);
  let rel = await table("TGE + 1일");
  const tgeBuckets = buckets.filter((b) => b.tgeBps > 0).map((b) => b.key);
  for (const b of buckets) {
    const expectPositive = b.tgeBps > 0;
    const got = rel[b.key] > 0n;
    if (expectPositive !== got) { ok = false; console.log(`  ❌ ${b.key}: TGE 해제 기대 ${expectPositive} / 실제 ${got}`); }
  }
  console.log(`  ✅ TGE 즉시 해제 버킷 = ${tgeBuckets.join(", ")}`);
  const mk = buckets.find((b) => b.key === "MARKETING");
  if (mk && rel.MARKETING > 0n) {
    const s = await vesting.schedules(ethers.id("MARKETING"));
    const before = await token.balanceOf(s.beneficiary);
    await (await vesting.release(ethers.id("MARKETING"))).wait();
    const after = await token.balanceOf(s.beneficiary);
    // release 트랜잭션이 담기는 블록은 releasable 을 읽은 블록보다 몇 초 뒤라 선형분이 조금 더 붙는다. 2분치 이내면 정상.
    const delta = after - before;
    const linear = s.total - (s.total * BigInt(s.tgeBps)) / 10000n;
    const perSec = s.duration > 0n ? linear / s.duration : 0n;
    const okRel = delta >= rel.MARKETING && delta - rel.MARKETING <= perSec * 120n;
    ok &= okRel;
    console.log(`  ${okRel ? "✅" : "❌"} MARKETING release(): ${L.fmt(delta)} 수령 (releasable 조회값 ${L.fmt(rel.MARKETING)} + 블록 간 선형분) → ${s.beneficiary}`);
  }

  // +6개월
  await warpTo(tge + 6n * L.MONTH + 3600n);
  rel = await table("TGE + 6개월");
  if (tl.timelock) {
    const timelock = await ethers.getContractAt("SLTimelock", tl.timelock);
    for (const o of ops.ops.filter((o) => !o.executed)) {
      const ready = await timelock.isOperationReady(o.opId);
      if (!ready) { ok = false; console.log(`  ❌ 타임락 작업 ${o.opId} 이 아직 ready 아님`); continue; }
      await (await timelock.execute(o.target, 0, o.data, ethers.ZeroHash, o.salt)).wait();
      const s = await vesting.schedules(ethers.id(o.bucket));
      const good = s.beneficiary.toLowerCase() === o.newBeneficiary.toLowerCase();
      ok &= good;
      o.executed = true;
      console.log(`  ${good ? "✅" : "❌"} 타임락 execute: ${o.bucket} 수혜자 → ${s.beneficiary}`);
    }
    L.saveJson(L.files.ops(), ops);
  }

  for (const m of [12n, 13n, 18n]) {
    await warpTo(tge + m * L.MONTH + 3600n);
    await table(`TGE + ${m}개월`);
  }

  // +24개월: LP 락
  await warpTo(tge + 24n * L.MONTH + 3600n);
  await table("TGE + 24개월");
  if (dex.lock) {
    const timelock = await ethers.getContractAt("SLTimelock", dex.lock.timelock);
    const ready = await timelock.isOperationReady(dex.lock.opId);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const shouldBeReady = BigInt(now) >= BigInt(dex.lock.ready);
    console.log(`  LP 락 ready=${ready} (해제 예정 ${dex.lock.readyIso}, 지금 ${new Date(now * 1000).toISOString()})`);
    if (ready !== shouldBeReady) { ok = false; console.log("  ❌ LP 락 ready 상태가 예약 시각과 불일치"); }
    else console.log("  ✅ LP 락 상태가 예약 시각과 일치");
  }

  console.log(ok ? "\n✅ TIMETRAVEL PASS" : "\n❌ TIMETRAVEL FAIL");
  if (!ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
