const hre = require("hardhat");
const { ethers } = hre;
const cfg = require("../config/allocations");

const MONTH = 30n * 24n * 60n * 60n; // 1개월 = 30일 (초)

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("배포자:", deployer.address);
  console.log("네트워크:", hre.network.name);

  const DECIMALS = 18n;
  const toWei = (whole) => BigInt(whole) * 10n ** DECIMALS;

  // 1) 합계 검증
  let sum = 0n;
  for (const b of cfg.buckets) sum += BigInt(b.amount);
  const total = BigInt(cfg.totalSupply);
  if (sum !== total) {
    throw new Error(`합계 불일치: 버킷 합 ${sum} != 총발행량 ${total}`);
  }
  console.log(`✅ 얼로케이션 합계 검증 통과: ${sum.toLocaleString()} 개`);

  // 2) 토큰 배포 (전량 deployer에게 민팅됨)
  const SLToken = await ethers.getContractFactory("SLToken");
  const token = await SLToken.deploy(deployer.address);
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  console.log("SLToken 배포:", tokenAddr);

  // 3) 베스팅 컨트랙트 배포
  const SLVesting = await ethers.getContractFactory("SLVesting");
  const vesting = await SLVesting.deploy(tokenAddr, deployer.address);
  await vesting.waitForDeployment();
  const vestingAddr = await vesting.getAddress();
  console.log("SLVesting 배포:", vestingAddr);

  // 4) TGE 시각. env TGE_TIMESTAMP(unix sec)로 상장 예정 시각을 지정.
  //    (감사 High 2) 베스팅 컨트랙트가 start >= now 를 강제하므로, 미지정 시 기본값은
  //    "지금 + 버퍼"로 둔다(배포가 여러 블록에 걸쳐도 start in past 방지). 메인넷은 반드시
  //    실제 상장 예정 시각을 TGE_TIMESTAMP로 지정할 것.
  const nowTs = BigInt((await ethers.provider.getBlock("latest")).timestamp);
  const DEFAULT_TGE_BUFFER = 3600n; // 1시간
  const tge = process.env.TGE_TIMESTAMP ? BigInt(process.env.TGE_TIMESTAMP) : nowTs + DEFAULT_TGE_BUFFER;
  console.log("TGE 시각(unix):", tge.toString(), process.env.TGE_TIMESTAMP ? "(지정)" : "(기본: now+1h)");

  // 5) 버킷별 분배
  console.log("\n--- 분배 시작 ---");
  for (const b of cfg.buckets) {
    const amount = toWei(b.amount);
    const wallet = b.wallet && b.wallet !== "" ? b.wallet : deployer.address;

    if (b.type === "burn") {
      const tx = await token.burn(amount);
      await tx.wait();
      console.log(`🔥 ${b.label}: ${b.amount} 소각`);
    } else if (b.type === "direct") {
      const tx = await token.transfer(wallet, amount);
      await tx.wait();
      console.log(`➡️  ${b.label}: ${b.amount} → ${wallet} (즉시 전송)`);
    } else if (b.type === "vesting") {
      // 토큰을 베스팅 컨트랙트로 이동
      let tx = await token.transfer(vestingAddr, amount);
      await tx.wait();
      // 스케줄 생성
      const id = ethers.id(b.key); // keccak256(key) → bytes32
      tx = await vesting.createSchedule(
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
        `🔒 ${b.label}: ${b.amount} → 베스팅 (TGE ${b.tgeBps / 100}%, cliff ${b.cliffMonths}m, linear ${b.durationMonths}m) 수혜:${wallet}`
      );
    } else {
      throw new Error(`알 수 없는 type: ${b.type}`);
    }
  }

  // 5-b) (감사 High 1) SLVesting 소유권 이전 — 48시간 타임락 멀티시그로.
  //      VESTING_OWNER 환경변수(= TimelockController 주소, 48h 지연, 멀티시그가 proposer)가
  //      지정된 경우에만 이전한다. 미지정 시 배포자에게 남으며, 메인넷 전 반드시 이전할 것.
  if (process.env.VESTING_OWNER) {
    const tx = await vesting.transferOwnership(process.env.VESTING_OWNER);
    await tx.wait();
    console.log(`\n🔐 SLVesting 소유권 이전 → ${process.env.VESTING_OWNER}`);
    console.log("   (48시간 타임락 멀티시그 주소여야 함)");
  } else {
    console.log(
      "\n⚠️  SLVesting 소유권이 배포자에게 있습니다. 메인넷에서는 VESTING_OWNER" +
        "(48h 타임락 멀티시그)로 이전 필요."
    );
  }

  // 6) 결과 확인
  const remaining = await token.balanceOf(deployer.address);
  const supplyNow = await token.totalSupply();
  console.log("\n--- 배포 완료 ---");
  console.log("현재 총공급량(소각 반영):", ethers.formatUnits(supplyNow, 18));
  console.log("배포자 잔여 잔액:", ethers.formatUnits(remaining, 18));
  console.log("\n주소 요약");
  console.log("  SLToken  :", tokenAddr);
  console.log("  SLVesting:", vestingAddr);

  // 7) 배포 주소를 파일로 저장 (검증 스크립트가 자동으로 읽음)
  const fs = require("fs");
  const path = require("path");
  const dir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${hre.network.name}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({ token: tokenAddr, vesting: vestingAddr, tge: tge.toString() }, null, 2)
  );
  console.log(`\n배포 주소 저장: deployments/${hre.network.name}.json`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});