/**
 * 불변식 검사 (읽기 전용)
 *
 *   npx hardhat run scripts/tge/invariants.js --network <net>
 *
 *   I1  totalSupply == 초기 발행량 − 소각 버킷 합
 *   I2  vesting 잔고 ≥ totalCommitted
 *   I3  totalCommitted + Σreleased == 베스팅 버킷 합
 *   I4  vesting.owner == VESTING_OWNER / timelock.json (있을 때)
 *   I5  배포자 잔고 == 배포자에게 배정된 direct 버킷 합 (LP 공급분·dust 는 차감 허용 → 경고로만)
 *   I6  라우터 승인(allowance) == 0 (dex.json 있을 때)
 *   I7  LP 락: 타임락 LP 잔고 == 락 수량, 해제 시각 == 예약값 (dex.json.lock 있을 때)
 */
const hre = require("hardhat");
const { ethers } = hre;
const cfg = require("../../config/allocations");
const L = require("./lib");

async function main() {
  const [deployer] = await ethers.getSigners();
  const dep = L.loadJson(L.files.deploy(), {});
  if (!dep.token || !dep.vesting) throw new Error("deployments/<network>.json 필요");
  const token = await ethers.getContractAt("SLToken", dep.token);
  const vesting = await ethers.getContractAt("SLVesting", dep.vesting);
  const results = [];
  const check = (id, cond, detail, warnOnly = false) => {
    results.push({ id, pass: !!cond, warnOnly, detail });
    console.log(`  ${cond ? "✅" : warnOnly ? "⚠️ " : "❌"} ${id}  ${detail}`);
  };

  const E18 = 10n ** 18n;
  const burnSum = cfg.buckets.filter((b) => b.type === "burn").reduce((a, b) => a + BigInt(b.amount), 0n) * E18;
  const vestSum = cfg.buckets.filter((b) => b.type === "vesting").reduce((a, b) => a + BigInt(b.amount), 0n) * E18;
  const initial = await token.INITIAL_SUPPLY();
  const supply = await token.totalSupply();
  check("I1 totalSupply", supply === initial - burnSum, `${L.fmt(supply)} (기대 ${L.fmt(initial - burnSum)})`);

  const vBal = await token.balanceOf(dep.vesting);
  const committed = await vesting.totalCommitted();
  check("I2 vesting 잔고 ≥ committed", vBal >= committed, `잔고 ${L.fmt(vBal)} / committed ${L.fmt(committed)}`);

  let released = 0n;
  for (const b of cfg.buckets.filter((b) => b.type === "vesting")) {
    const s = await vesting.schedules(ethers.id(b.key));
    released += s.released;
  }
  check("I3 committed + released == 베스팅 합", committed + released === vestSum, `${L.fmt(committed)} + ${L.fmt(released)} = ${L.fmt(vestSum)}`);

  const owner = await vesting.owner();
  const tl = L.loadJson(L.files.timelock(), {});
  const expectedOwner = process.env.VESTING_OWNER || tl.timelock;
  if (expectedOwner) check("I4 owner == 타임락", owner.toLowerCase() === expectedOwner.toLowerCase(), `${owner}`);
  else check("I4 owner", owner.toLowerCase() !== deployer.address.toLowerCase(), `${owner} (배포자면 메인넷 부적합)`, true);

  const selfDirect = cfg.buckets
    .filter((b) => b.type === "direct" && (!b.wallet || b.wallet.toLowerCase() === deployer.address.toLowerCase()))
    .reduce((a, b) => a + BigInt(b.amount), 0n) * E18;
  const dBal = await token.balanceOf(deployer.address);
  check("I5 배포자 잔고", dBal <= selfDirect, `${L.fmt(dBal)} (배포자 배정 direct 합 ${L.fmt(selfDirect)}; LP·dust 차감분은 허용)`, true);

  const dex = L.loadJson(L.files.dex(), {});
  if (dex.router) {
    const al1 = await token.allowance(deployer.address, dex.router);
    let al2 = 0n;
    if (dex.usdt) al2 = await new ethers.Contract(dex.usdt, L.ERC20_ABI, ethers.provider).allowance(deployer.address, dex.router);
    check("I6 라우터 승인 0", al1 === 0n && al2 === 0n, `SL ${L.fmt(al1)} / USDT ${L.fmt(al2)}`);
  }
  if (dex.lock) {
    const pair = new ethers.Contract(dex.lock.target, L.PAIR_ABI, ethers.provider);
    const held = await pair.balanceOf(dex.lock.timelock);
    const timelock = await ethers.getContractAt("SLTimelock", dex.lock.timelock);
    const ts = await timelock.getTimestamp(dex.lock.opId);
    const pending = await timelock.isOperationPending(dex.lock.opId);
    check("I7 LP 락", held === BigInt(dex.lock.amount) && ts.toString() === dex.lock.ready && pending, `타임락 LP ${L.fmt(held)} · 해제 ${dex.lock.readyIso} · pending ${pending}`);
  }

  const failed = results.filter((r) => !r.pass && !r.warnOnly);
  console.log(failed.length ? `\n❌ INVARIANTS FAIL (${failed.length})` : "\n✅ INVARIANTS PASS");
  if (failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
