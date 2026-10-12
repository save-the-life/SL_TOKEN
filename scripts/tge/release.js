/**
 * 베스팅 청구 실행 — releasable 을 읽고 release(id) 를 호출해 수혜 지갑 잔고 변화를 확인한다.
 *
 *   BUCKET=MARKETING npx hardhat run scripts/tge/release.js --network <net>
 *
 * 청구할 게 없으면(클리프 전) 컨트랙트의 "nothing to release" revert 를 그대로 보여준다.
 * 누구나 호출할 수 있고(수혜자 지갑으로만 전송됨) 가스만 든다.
 */
const hre = require("hardhat");
const { ethers } = hre;
const L = require("./lib");

async function main() {
  const bucket = process.env.BUCKET || "MARKETING";
  const dep = L.loadJson(L.files.deploy(), {});
  if (!dep.vesting) throw new Error("deployments/<network>.json 필요");
  const vesting = await ethers.getContractAt("SLVesting", dep.vesting);
  const token = await ethers.getContractAt("SLToken", dep.token);
  const id = ethers.id(bucket);
  const s = await vesting.schedules(id);
  if (!s.exists) throw new Error(`스케줄 없음: ${bucket}`);
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const rel = await vesting.releasable(id);

  console.log(`RELEASE — ${bucket}  vesting ${dep.vesting}`);
  console.log(`  수혜자 ${s.beneficiary}  총 ${L.fmt(s.total)}  누적 청구 ${L.fmt(s.released)}`);
  console.log(`  start ${new Date(Number(s.start) * 1000).toISOString()}  cliff ${Number(s.cliff) / 86400}일  linear ${Number(s.duration) / 86400}일  TGE ${Number(s.tgeBps) / 100}%`);
  console.log(`  체인 시각 ${new Date(now * 1000).toISOString()}  → 지금 청구 가능 ${L.fmt(rel)}`);

  const before = await token.balanceOf(s.beneficiary);
  try {
    const tx = await vesting.release(id);
    const rc = await tx.wait();
    const after = await token.balanceOf(s.beneficiary);
    console.log(`✅ release 완료  +${L.fmt(after - before)} SL → ${s.beneficiary}  tx ${rc.hash}`);
  } catch (e) {
    const msg = (e.shortMessage || e.message || "").split("\n")[0];
    if (rel === 0n) console.log(`✅ 예상대로 revert (청구할 게 없음): ${msg}`);
    else {
      console.log(`❌ release 실패: ${msg}`);
      process.exitCode = 1;
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
