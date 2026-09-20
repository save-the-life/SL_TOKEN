/**
 * 배포 전 점검 (읽기 전용 · 트랜잭션 없음)
 *
 *   npx hardhat run scripts/preflight.js --network <net>
 *
 * 검사 항목
 *   1) RPC chainId 가 설정과 일치하는지, 메인넷이 아닌지
 *   2) 배포자 가스 잔고
 *   3) 얼로케이션 버킷 합계 = 총발행량
 *   4) TGE_TIMESTAMP 범위 [now, now+365d] (컨트랙트가 강제하는 범위와 동일)
 *   5) 각 버킷 지갑 주소 형식 + 코드 존재 여부 (Safe 는 체인마다 주소가 다를 수 있다)
 *      REQUIRE_CONTRACT_WALLETS=1 이면 EOA 지갑을 실패로 처리 (메인넷 필수)
 *   6) VESTING_OWNER(타임락) 코드 존재 여부
 */
const hre = require("hardhat");
const { ethers } = hre;
const cfg = require("../config/allocations");

async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const fails = [];
  const warns = [];
  const ok = (m) => console.log("  ✅", m);

  console.log(`PREFLIGHT — network=${hre.network.name}`);

  // 1) chain
  const expected = hre.network.config.chainId;
  if (expected && expected !== chainId) fails.push(`chainId 불일치: RPC=${chainId}, config=${expected}`);
  else ok(`chainId ${chainId}`);
  if ([56, 204].includes(chainId)) {
    fails.push("메인넷 chainId 감지 — 이 설정 파일로는 메인넷에 배포하지 않는다 (hardhat.mainnet.config.js 사용)");
  }

  // 2) balance
  const bal = await ethers.provider.getBalance(deployer.address);
  if (bal < ethers.parseEther("0.02")) fails.push(`배포자 ${deployer.address} 가스 잔고 부족: ${ethers.formatEther(bal)}`);
  else ok(`배포자 ${deployer.address} 잔고 ${ethers.formatEther(bal)}`);

  // 3) sum
  let sum = 0n;
  for (const b of cfg.buckets) sum += BigInt(b.amount);
  if (sum !== BigInt(cfg.totalSupply)) fails.push(`버킷 합계 ${sum} != 총발행량 ${cfg.totalSupply}`);
  else ok(`버킷 합계 ${sum.toLocaleString()} = 총발행량`);

  // 4) TGE
  const now = BigInt((await ethers.provider.getBlock("latest")).timestamp);
  if (process.env.TGE_TIMESTAMP) {
    const t = BigInt(process.env.TGE_TIMESTAMP);
    if (t < now) fails.push(`TGE_TIMESTAMP ${t} 가 과거 (now ${now})`);
    else if (t > now + 365n * 86400n) fails.push("TGE_TIMESTAMP 가 now+365d 초과 (컨트랙트가 거부)");
    else ok(`TGE ${new Date(Number(t) * 1000).toISOString()} (now + ${(t - now) / 3600n}h)`);
  } else {
    warns.push("TGE_TIMESTAMP 미지정 → 배포 시각+1h 기본값 (메인넷에서는 금지)");
  }

  // 5) wallets
  const requireContracts = process.env.REQUIRE_CONTRACT_WALLETS === "1";
  for (const b of cfg.buckets) {
    if (b.type === "burn") continue;
    if (!b.wallet) {
      warns.push(`${b.key}: wallet 비어 있음 → 배포자에게 배정됨`);
      continue;
    }
    if (!ethers.isAddress(b.wallet)) {
      fails.push(`${b.key}: 주소 형식 오류 ${b.wallet}`);
      continue;
    }
    const code = await ethers.provider.getCode(b.wallet);
    if (code === "0x") {
      (requireContracts ? fails : warns).push(
        `${b.key}: ${b.wallet} 는 EOA(코드 없음)${requireContracts ? " — 컨트랙트 지갑(Safe) 필수" : ""}`
      );
    } else ok(`${b.key}: 컨트랙트 지갑 확인 ${b.wallet}`);
  }

  // 6) owner
  if (process.env.VESTING_OWNER) {
    if (!ethers.isAddress(process.env.VESTING_OWNER)) fails.push("VESTING_OWNER 주소 형식 오류");
    else {
      const code = await ethers.provider.getCode(process.env.VESTING_OWNER);
      if (code === "0x") fails.push(`VESTING_OWNER ${process.env.VESTING_OWNER} 에 코드 없음 (타임락 주소인지 확인)`);
      else ok(`VESTING_OWNER 컨트랙트 확인 ${process.env.VESTING_OWNER}`);
    }
  } else warns.push("VESTING_OWNER 미지정 → SLVesting 소유권이 배포자에게 남음 (메인넷에서는 금지)");

  if (warns.length) {
    console.log("\n  경고:");
    for (const w of warns) console.log("  ⚠️ ", w);
  }
  if (fails.length) {
    console.log("\n  실패:");
    for (const f of fails) console.log("  ❌", f);
    console.log("\n❌ PREFLIGHT FAIL");
    process.exitCode = 1;
  } else {
    console.log("\n✅ PREFLIGHT PASS");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
