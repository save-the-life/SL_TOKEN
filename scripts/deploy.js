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

  // 4) TGE 시각 (기본: 지금). 필요시 env TGE_TIMESTAMP(unix sec)로 지정.
  const tgeNow = BigInt((await ethers.provider.getBlock("latest")).timestamp);
  const tge = process.env.TGE_TIMESTAMP ? BigInt(process.env.TGE_TIMESTAMP) : tgeNow;
  console.log("TGE 시각(unix):", tge.toString());

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