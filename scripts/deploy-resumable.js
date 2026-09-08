/**
 * 재개 가능한 배포·분배 스크립트 (deploy.js 와 같은 순서, 체크포인트 추가)
 *
 *   npx hardhat run scripts/deploy-resumable.js --network <net>
 *
 * deploy.js 와의 차이
 *   - 각 단계 완료를 deployments/<network>.progress.json 에 기록. 중단 후 재실행하면 완료된 단계는 건너뛴다.
 *   - TGE 시각은 최초 1회만 결정해 progress 에 고정 (재실행 때 바뀌지 않음).
 *   - direct 버킷은 1 SL dust 전송 → 잔고 확인 → 나머지 전송 (주소 오류를 본 전송 전에 잡는다).
 *   - 각 전송 전에 온체인 상태로 "이미 처리됨"을 재확인 (기록 저장 직전에 죽었어도 중복 전송 없음).
 *   - FAIL_AFTER_STEP=N : N개 단계 완료 후 강제 종료 (재개 테스트용).
 *
 * 환경변수: TGE_TIMESTAMP, VESTING_OWNER (deploy.js 와 동일), FAIL_AFTER_STEP (테스트)
 */
const hre = require("hardhat");
const { ethers } = hre;
const cfg = require("../config/allocations");
const L = require("./tge/lib");

const MONTH = L.MONTH;
const DUST = 10n ** 18n; // 1 SL

async function main() {
  const [deployer] = await ethers.getSigners();
  const pf = L.files.progress();
  const progress = L.loadJson(pf, { network: hre.network.name, deployer: deployer.address, steps: {} });
  if (progress.deployer && progress.deployer.toLowerCase() !== deployer.address.toLowerCase()) {
    throw new Error(`progress 파일의 배포자(${progress.deployer})와 현재 서명자(${deployer.address})가 다릅니다`);
  }
  const save = () => L.saveJson(pf, progress);
  const FAIL_AFTER = Number(process.env.FAIL_AFTER_STEP || 0);
  let doneThisRun = 0;

  async function step(name, fn) {
    if (progress.steps[name]) {
      console.log(`⏭  ${name} (이미 완료)`);
      return progress.steps[name];
    }
    const r = await fn();
    progress.steps[name] = r === undefined ? true : r;
    save();
    doneThisRun++;
    if (FAIL_AFTER && doneThisRun >= FAIL_AFTER) {
      console.log(`\n💥 FAIL_AFTER_STEP=${FAIL_AFTER} 도달 — 강제 중단(테스트). 다시 실행하면 이어서 진행됩니다.`);
      process.exit(2);
    }
    return r;
  }

  console.log("배포자:", deployer.address);
  console.log("네트워크:", hre.network.name);
  console.log("progress:", pf);

  // 1) 합계 검증
  let sum = 0n;
  for (const b of cfg.buckets) sum += BigInt(b.amount);
  if (sum !== BigInt(cfg.totalSupply)) throw new Error(`합계 불일치: ${sum} != ${cfg.totalSupply}`);
  console.log(`✅ 얼로케이션 합계 검증 통과: ${sum.toLocaleString()} 개`);

  // 2) 토큰
  const tokenAddr = await step("token", async () => {
    const F = await ethers.getContractFactory("SLToken");
    const c = await F.deploy(deployer.address);
    await c.waitForDeployment();
    const a = await c.getAddress();
    console.log("SLToken 배포:", a);
    return a;
  });
  progress.token = tokenAddr;
  const token = await ethers.getContractAt("SLToken", tokenAddr);

  // 3) 베스팅
  const vestingAddr = await step("vesting", async () => {
    const F = await ethers.getContractFactory("SLVesting");
    const c = await F.deploy(tokenAddr, deployer.address);
    await c.waitForDeployment();
    const a = await c.getAddress();
    console.log("SLVesting 배포:", a);
    return a;
  });
  progress.vesting = vestingAddr;
  const vesting = await ethers.getContractAt("SLVesting", vestingAddr);

  // 4) TGE 시각 (최초 1회 고정)
  if (!progress.tge) {
    const nowTs = BigInt((await ethers.provider.getBlock("latest")).timestamp);
    const tge = process.env.TGE_TIMESTAMP ? BigInt(process.env.TGE_TIMESTAMP) : nowTs + 3600n;
    progress.tge = tge.toString();
    progress.tgeSource = process.env.TGE_TIMESTAMP ? "env" : "default(now+1h)";
    save();
  }
  const tge = BigInt(progress.tge);
  console.log("TGE 시각(unix):", tge.toString(), `(${progress.tgeSource})`, new Date(Number(tge) * 1000).toISOString());

  // 5) 분배
  console.log("\n--- 분배 ---");
  const initial = await token.INITIAL_SUPPLY();
  for (const b of cfg.buckets) {
    const amount = BigInt(b.amount) * 10n ** 18n;
    const wallet = b.wallet && b.wallet !== "" ? b.wallet : deployer.address;

    if (b.type === "burn") {
      await step(`bucket:${b.key}:burn`, async () => {
        const burnedSoFar = initial - (await token.totalSupply());
        if (burnedSoFar >= amount) return "already-burned";
        const tx = await token.burn(amount);
        await tx.wait();
        console.log(`🔥 ${b.label}: ${b.amount} 소각  ${tx.hash}`);
        return tx.hash;
      });
    } else if (b.type === "direct") {
      if (wallet.toLowerCase() === deployer.address.toLowerCase()) {
        await step(`bucket:${b.key}:self`, async () => {
          console.log(`➡️  ${b.label}: ${b.amount} 배포자 보유 (wallet 미지정)`);
          return "deployer-holds";
        });
        continue;
      }
      await step(`bucket:${b.key}:dust`, async () => {
        const before = await token.balanceOf(wallet);
        if (before >= DUST) return "already-has-dust";
        const tx = await token.transfer(wallet, DUST);
        await tx.wait();
        const after = await token.balanceOf(wallet);
        if (after < DUST) throw new Error(`dust 확인 실패: ${wallet} 잔고 ${after}`);
        console.log(`🧪 ${b.label}: dust 1 SL → ${wallet} 확인  ${tx.hash}`);
        return tx.hash;
      });
      await step(`bucket:${b.key}:rest`, async () => {
        const before = await token.balanceOf(wallet);
        if (before >= amount) return "already-funded";
        const tx = await token.transfer(wallet, amount - before);
        await tx.wait();
        console.log(`➡️  ${b.label}: ${b.amount} → ${wallet}  ${tx.hash}`);
        return tx.hash;
      });
    } else if (b.type === "vesting") {
      await step(`bucket:${b.key}:fund`, async () => {
        const surplus = (await token.balanceOf(vestingAddr)) - (await vesting.totalCommitted());
        if (surplus >= amount) return "already-funded";
        const tx = await token.transfer(vestingAddr, amount - surplus);
        await tx.wait();
        return tx.hash;
      });
      await step(`bucket:${b.key}:schedule`, async () => {
        const id = ethers.id(b.key);
        const s = await vesting.schedules(id);
        if (s.exists) return "already-scheduled";
        const tx = await vesting.createSchedule(
          id,
          wallet,
          amount,
          tge,
          BigInt(b.cliffMonths) * MONTH,
          BigInt(b.durationMonths) * MONTH,
          b.tgeBps
        );
        await tx.wait();
        console.log(
          `🔒 ${b.label}: ${b.amount} → 베스팅 (TGE ${b.tgeBps / 100}%, cliff ${b.cliffMonths}m, linear ${b.durationMonths}m) 수혜:${wallet}  ${tx.hash}`
        );
        return tx.hash;
      });
    } else {
      throw new Error(`알 수 없는 type: ${b.type}`);
    }
  }

  // 6) 소유권 이전
  if (process.env.VESTING_OWNER) {
    await step("owner", async () => {
      const cur = await vesting.owner();
      if (cur.toLowerCase() === process.env.VESTING_OWNER.toLowerCase()) return "already-transferred";
      const code = await ethers.provider.getCode(process.env.VESTING_OWNER);
      if (code === "0x") throw new Error("VESTING_OWNER 에 코드 없음 — 타임락 주소인지 확인");
      const tx = await vesting.transferOwnership(process.env.VESTING_OWNER);
      await tx.wait();
      console.log(`\n🔐 SLVesting 소유권 이전 → ${process.env.VESTING_OWNER}  ${tx.hash}`);
      return tx.hash;
    });
  } else {
    console.log("\n⚠️  SLVesting 소유권이 배포자에게 있습니다. 메인넷에서는 VESTING_OWNER(48h 타임락)로 이전 필요.");
  }

  // 7) 결과
  const remaining = await token.balanceOf(deployer.address);
  const supplyNow = await token.totalSupply();
  console.log("\n--- 배포 완료 ---");
  console.log("현재 총공급량(소각 반영):", ethers.formatUnits(supplyNow, 18));
  console.log("배포자 잔여 잔액:", ethers.formatUnits(remaining, 18));
  console.log("SLVesting owner:", await vesting.owner());
  console.log("  SLToken  :", tokenAddr);
  console.log("  SLVesting:", vestingAddr);

  L.saveJson(L.files.deploy(), {
    token: tokenAddr,
    vesting: vestingAddr,
    tge: progress.tge,
    owner: await vesting.owner(),
    deployer: deployer.address,
  });
  progress.completedAt = new Date().toISOString();
  save();
  console.log(`\n배포 주소 저장: deployments/${hre.network.name}.json`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
