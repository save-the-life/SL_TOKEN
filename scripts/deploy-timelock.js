/**
 * SLTimelock(OpenZeppelin TimelockController) 배포
 *
 *   TIMELOCK_DELAY=172800 TIMELOCK_PROPOSERS=0xSafe TIMELOCK_EXECUTORS=0xSafe \
 *     npx hardhat run scripts/deploy-timelock.js --network <net>
 *
 *   - TIMELOCK_DELAY     최소 지연(초). 기본 172800 = 48h. 로컬 테스트는 60 등으로 줄여도 된다.
 *   - TIMELOCK_PROPOSERS 쉼표 구분. 기본 = 배포자 (솔로 리허설). 팀 리허설·메인넷은 Safe 주소.
 *   - TIMELOCK_EXECUTORS 쉼표 구분. 기본 = proposers.
 *   admin 은 address(0) — 타임락이 스스로의 관리자(역할 변경도 지연 적용).
 */
const hre = require("hardhat");
const { ethers } = hre;
const L = require("./tge/lib");

async function main() {
  const [deployer] = await ethers.getSigners();
  const delay = BigInt(process.env.TIMELOCK_DELAY || "172800");
  const proposers = (process.env.TIMELOCK_PROPOSERS || deployer.address).split(",").map((s) => s.trim());
  const executors = (process.env.TIMELOCK_EXECUTORS || proposers.join(",")).split(",").map((s) => s.trim());
  for (const a of [...proposers, ...executors]) if (!ethers.isAddress(a)) throw new Error(`주소 형식 오류: ${a}`);

  const F = await ethers.getContractFactory("SLTimelock");
  const tl = await F.deploy(delay, proposers, executors, ethers.ZeroAddress);
  await tl.waitForDeployment();
  const addr = await tl.getAddress();

  console.log("SLTimelock:", addr);
  console.log("  minDelay :", delay.toString(), "초", `(${Number(delay) / 3600}h)`);
  console.log("  proposers:", proposers.join(", "));
  console.log("  executors:", executors.join(", "));
  console.log("  admin    : address(0) (self-administered)");

  L.saveJson(L.files.timelock(), {
    timelock: addr,
    minDelay: delay.toString(),
    proposers,
    executors,
    deployedAt: new Date().toISOString(),
  });
  console.log(`\n다음 단계에서 사용:  VESTING_OWNER=${addr}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
