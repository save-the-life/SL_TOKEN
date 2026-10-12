/**
 * (적대 시나리오) 누군가 우리보다 먼저 SL/USDT 페어를 만들고 엉뚱한 가격에 소액 유동성을 넣는 상황을 재현한다.
 *
 *   HOSTILE_SL=1000 HOSTILE_USDT=1000 npx hardhat run scripts/tge/hostile-precreate.js --network <net>
 *
 * 기본값은 1 USDT/SL (목표 0.01 의 100배). 이후 add-liquidity-v2.js 가 이를 감지하고 중단해야 한다.
 * 리허설이므로 같은 배포자 지갑을 쓴다(실전에서는 제3자).
 */
const hre = require("hardhat");
const { ethers } = hre;
const L = require("./lib");

async function main() {
  const [signer] = await ethers.getSigners();
  const dex = await L.resolveDex();
  const tokenAddr = L.tokenAddress();
  const usdt = new ethers.Contract(dex.usdt, L.ERC20_ABI, signer);
  const usdtDec = Number(await usdt.decimals());
  const slAmt = ethers.parseUnits(process.env.HOSTILE_SL || "1000", 18);
  const usdtAmt = ethers.parseUnits(process.env.HOSTILE_USDT || "1000", usdtDec);

  const before = await L.pairInfo(dex, tokenAddr, signer);
  if (before.exists && (before.rSL > 0n || before.rUSDT > 0n)) {
    console.log(`페어가 이미 유동성을 갖고 있습니다 (${before.pairAddr}) — 선점 시나리오는 빈 페어에서만 의미가 있습니다.`);
    return;
  }

  await L.approveExact(tokenAddr, dex.router, slAmt, signer);
  await L.approveExact(dex.usdt, dex.router, usdtAmt, signer);
  const router = new ethers.Contract(dex.router, L.ROUTER_ABI, signer);
  const tx = await router.addLiquidity(tokenAddr, dex.usdt, slAmt, usdtAmt, 0, 0, signer.address, await L.deadline());
  const rc = await tx.wait();
  await L.revoke(tokenAddr, dex.router, signer);
  await L.revoke(dex.usdt, dex.router, signer);

  const after = await L.pairInfo(dex, tokenAddr, signer);
  console.log(`😈 선점 완료  pair ${after.pairAddr}  tx ${rc.hash}`);
  console.log(`   reserves SL ${L.fmt(after.rSL)} / USDT ${L.fmt(after.rUSDT, usdtDec)} → ${L.priceOf(after.rSL, after.rUSDT, usdtDec)} USDT/SL`);
  console.log("   이제 add-liquidity-v2.js 를 실행하면 '중단' 이 나와야 정상입니다.");
  L.mergeJson(L.files.dex(), { hostilePair: after.pairAddr, hostileTx: rc.hash });
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
