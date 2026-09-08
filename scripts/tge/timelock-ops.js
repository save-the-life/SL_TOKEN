/**
 * 타임락을 통한 SLVesting 오너 작업 (schedule → 대기 → execute)
 *
 *   ACTION=schedule BUCKET=ADVISORS NEW_BENEFICIARY=0x... npx hardhat run scripts/tge/timelock-ops.js --network <net>
 *   ACTION=status                                          npx hardhat run scripts/tge/timelock-ops.js --network <net>
 *   ACTION=execute [OP_ID=0x...]                           npx hardhat run scripts/tge/timelock-ops.js --network <net>
 *
 * 현재 지원 작업: updateBeneficiary(bucket, newBeneficiary). 작업 기록은 deployments/<network>.timelock-ops.json.
 * 배포자가 proposer/executor 여야 한다(솔로 모드). 팀 모드에서는 Safe UI 에서 같은 calldata 로 제안한다.
 */
const hre = require("hardhat");
const { ethers } = hre;
const L = require("./lib");

async function main() {
  const [signer] = await ethers.getSigners();
  const dep = L.loadJson(L.files.deploy(), {});
  const tlj = L.loadJson(L.files.timelock(), {});
  if (!dep.vesting || !tlj.timelock) throw new Error("deployments/<network>.json 과 .timelock.json 이 필요합니다");
  const vesting = await ethers.getContractAt("SLVesting", dep.vesting);
  const timelock = await ethers.getContractAt("SLTimelock", tlj.timelock);
  const ops = L.loadJson(L.files.ops(), { ops: [] });
  const action = process.env.ACTION || "status";

  if (action === "schedule") {
    const bucket = process.env.BUCKET;
    const nb = process.env.NEW_BENEFICIARY;
    if (!bucket || !ethers.isAddress(nb)) throw new Error("BUCKET 과 NEW_BENEFICIARY(주소) 필요");
    const owner = await vesting.owner();
    if (owner.toLowerCase() !== tlj.timelock.toLowerCase()) throw new Error(`SLVesting owner(${owner}) 가 타임락이 아닙니다`);
    const id = ethers.id(bucket);
    const before = await vesting.schedules(id);
    if (!before.exists) throw new Error(`스케줄 없음: ${bucket}`);
    const data = vesting.interface.encodeFunctionData("updateBeneficiary", [id, nb]);
    const salt = ethers.keccak256(ethers.toUtf8Bytes(`${bucket}:${nb}:${Date.now()}`));
    const delay = await timelock.getMinDelay();
    const tx = await timelock.schedule(dep.vesting, 0, data, ethers.ZeroHash, salt, delay);
    await tx.wait();
    const opId = await timelock.hashOperation(dep.vesting, 0, data, ethers.ZeroHash, salt);
    const ready = await timelock.getTimestamp(opId);
    const rec = {
      opId, kind: "updateBeneficiary", bucket, oldBeneficiary: before.beneficiary, newBeneficiary: nb,
      target: dep.vesting, data, salt, ready: ready.toString(), readyIso: new Date(Number(ready) * 1000).toISOString(),
      scheduledTx: tx.hash, executed: false,
    };
    ops.ops.push(rec);
    L.saveJson(L.files.ops(), ops);
    console.log(`🕒 예약 완료  op ${opId}`);
    console.log(`   ${bucket} 수혜자 ${before.beneficiary} → ${nb}`);
    console.log(`   실행 가능 시각: ${rec.readyIso} (minDelay ${Number(delay) / 3600}h)  tx ${tx.hash}`);
    return;
  }

  if (action === "execute") {
    const pending = ops.ops.filter((o) => !o.executed);
    const op = process.env.OP_ID ? pending.find((o) => o.opId === process.env.OP_ID) : pending[pending.length - 1];
    if (!op) throw new Error("실행할 예약 작업이 없습니다");
    const ready = await timelock.isOperationReady(op.opId);
    if (!ready) {
      const ts = await timelock.getTimestamp(op.opId);
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      throw new Error(`아직 실행 불가 — ready ${new Date(Number(ts) * 1000).toISOString()}, 체인 시각 ${new Date(now * 1000).toISOString()}`);
    }
    const tx = await timelock.execute(op.target, 0, op.data, ethers.ZeroHash, op.salt);
    await tx.wait();
    const after = await vesting.schedules(ethers.id(op.bucket));
    if (after.beneficiary.toLowerCase() !== op.newBeneficiary.toLowerCase()) throw new Error("실행 후 수혜자가 바뀌지 않았습니다");
    op.executed = true;
    op.executedTx = tx.hash;
    L.saveJson(L.files.ops(), ops);
    console.log(`✅ 실행 완료  ${op.bucket} 수혜자 → ${after.beneficiary}  tx ${tx.hash}`);
    return;
  }

  // status
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  console.log(`timelock ${tlj.timelock}  minDelay ${Number(await timelock.getMinDelay()) / 3600}h  체인 시각 ${new Date(now * 1000).toISOString()}`);
  console.log(`SLVesting owner: ${await vesting.owner()}`);
  if (!ops.ops.length) console.log("예약 작업 없음");
  for (const o of ops.ops) {
    const st = o.executed ? "executed" : (await timelock.isOperationReady(o.opId)) ? "READY" : "pending";
    console.log(`  ${st.padEnd(9)} ${o.kind} ${o.bucket} → ${o.newBeneficiary}  ready ${o.readyIso}  op ${o.opId}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
