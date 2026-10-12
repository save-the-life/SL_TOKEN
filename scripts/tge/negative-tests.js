/**
 * 부정 테스트 (읽기 전용 · eth_call 로만 확인, 트랜잭션 없음)
 *
 *   npx hardhat run scripts/tge/negative-tests.js --network <net>
 *
 *   1) 임의 주소가 createSchedule 호출 → revert
 *   2) 임의 주소가 sweep 호출 → revert
 *   3) 클리프 전 TEAM release 호출 → "nothing to release" revert (클리프가 지났으면 건너뜀)
 *   4) 소유권을 이전했다면, 배포자의 transferOwnership 호출 → revert
 */
const hre = require("hardhat");
const { ethers } = hre;
const L = require("./lib");

async function expectRevert(label, p) {
  try {
    await p;
    console.log(`  ❌ ${label}: revert 가 없었습니다`);
    return false;
  } catch (e) {
    const msg = (e.shortMessage || e.message || "").split("\n")[0].slice(0, 120);
    console.log(`  ✅ ${label}: revert (${msg})`);
    return true;
  }
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const dep = L.loadJson(L.files.deploy(), {});
  if (!dep.vesting) throw new Error("deployments/<network>.json 필요");
  const vesting = await ethers.getContractAt("SLVesting", dep.vesting);
  const stranger = ethers.Wallet.createRandom().connect(ethers.provider);
  const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
  let ok = true;

  console.log(`NEGATIVE TESTS — vesting ${dep.vesting}  stranger ${stranger.address}`);
  ok &= await expectRevert(
    "stranger.createSchedule",
    vesting.connect(stranger).createSchedule.staticCall(ethers.id("X"), stranger.address, 1n, now + 100n, 0n, 0n, 0)
  );
  ok &= await expectRevert("stranger.sweep", vesting.connect(stranger).sweep.staticCall(dep.token, stranger.address));

  const team = await vesting.schedules(ethers.id("TEAM"));
  if (team.exists && now < BigInt(team.start) + BigInt(team.cliff)) {
    ok &= await expectRevert("release(TEAM) before cliff", vesting.connect(stranger).release.staticCall(ethers.id("TEAM")));
  } else console.log("  ⏭  TEAM 클리프가 지났거나 스케줄 없음 — release 부정 테스트 건너뜀");

  const owner = await vesting.owner();
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    ok &= await expectRevert("deployer.transferOwnership (after transfer)", vesting.connect(deployer).transferOwnership.staticCall(deployer.address));
  } else console.log("  ⚠️  owner 가 아직 배포자 — 소유권 이전 후 다시 실행하면 4번 항목도 검증됨");

  console.log(ok ? "\n✅ NEGATIVE TESTS PASS" : "\n❌ NEGATIVE TESTS FAIL");
  if (!ok) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
