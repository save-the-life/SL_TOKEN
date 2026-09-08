/**
 * LP 토큰 락 — SLTimelock 에 LP 를 보내고 "LOCK_SECONDS 뒤 수령 지갑으로 전송" 작업을 예약한다.
 * 누구나 timelock.getTimestamp(opId) 로 해제 시각을 온체인에서 확인할 수 있다.
 *
 *   LOCK_SECONDS=63072000 LOCK_RECIPIENT=0xTreasurySafe npx hardhat run scripts/tge/lock-lp.js --network <net>
 *
 *   - LOCK_SECONDS   기본 63072000 = 730일(24개월). 타임락 minDelay 이상이어야 한다.
 *   - LOCK_RECIPIENT 해제 후 LP 를 받을 주소. 기본 배포자.
 *   배포자가 타임락 proposer 여야 한다(솔로 리허설 기본값). 팀 모드에서는 Safe 에서 같은 schedule 을 제안.
 */
const hre = require("hardhat");
const { ethers } = hre;
const L = require("./lib");

async function main() {
  const [signer] = await ethers.getSigners();
  const dexInfo = L.loadJson(L.files.dex(), {});
  const tl = L.loadJson(L.files.timelock(), {});
  if (!dexInfo.pair) throw new Error("deployments/<network>.dex.json 에 pair 가 없습니다 (add-liquidity 먼저)");
  if (!tl.timelock) throw new Error("deployments/<network>.timelock.json 이 없습니다 (deploy-timelock 먼저)");

  const lockSecs = BigInt(process.env.LOCK_SECONDS || String(730 * 24 * 3600));
  const recipient = process.env.LOCK_RECIPIENT || signer.address;
  const pair = new ethers.Contract(dexInfo.pair, L.PAIR_ABI, signer);
  const timelock = await ethers.getContractAt("SLTimelock", tl.timelock);

  const minDelay = await timelock.getMinDelay();
  if (lockSecs < minDelay) throw new Error(`LOCK_SECONDS(${lockSecs}) < minDelay(${minDelay})`);

  const lpBal = await pair.balanceOf(signer.address);
  if (lpBal === 0n) throw new Error("배포자 LP 잔고 0");

  // 1) LP → 타임락
  const t1 = await pair.transfer(tl.timelock, lpBal);
  await t1.wait();
  const held = await pair.balanceOf(tl.timelock);
  console.log(`LP ${L.fmt(lpBal)} → 타임락 ${tl.timelock} (보유 ${L.fmt(held)})  ${t1.hash}`);

  // 2) 해제 예약: pair.transfer(recipient, lpBal) 를 lockSecs 뒤에
  const data = pair.interface.encodeFunctionData("transfer", [recipient, lpBal]);
  const salt = ethers.keccak256(ethers.toUtf8Bytes(`SL-LP-LOCK:${dexInfo.pair}:${Date.now()}`));
  const t2 = await timelock.schedule(dexInfo.pair, 0, data, ethers.ZeroHash, salt, lockSecs);
  await t2.wait();
  const opId = await timelock.hashOperation(dexInfo.pair, 0, data, ethers.ZeroHash, salt);
  const ready = await timelock.getTimestamp(opId);
  const readyIso = new Date(Number(ready) * 1000).toISOString();

  console.log(`🔒 락 예약 완료  op ${opId}`);
  console.log(`   해제 가능 시각: ${ready} (${readyIso})  = 지금 + ${Number(lockSecs) / 86400} 일`);
  console.log(`   수령 지갑: ${recipient}`);
  console.log(`   검증: timelock.getTimestamp(op) / isOperationPending(op)`);

  L.mergeJson(L.files.dex(), {
    lock: {
      timelock: tl.timelock,
      opId,
      target: dexInfo.pair,
      data,
      salt,
      amount: lpBal.toString(),
      recipient,
      ready: ready.toString(),
      readyIso,
      txTransfer: t1.hash,
      txSchedule: t2.hash,
    },
  });
  console.log(`저장: deployments/${hre.network.name}.dex.json (lock)`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
