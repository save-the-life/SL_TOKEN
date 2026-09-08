/**
 * 트레이딩 리허설 — 여러 크기의 매수/매도를 실제로 실행해 가격 임팩트와 ±2% 심도를 표로 낸다.
 *
 *   TRADE_FRACTIONS=0.001,0.005,0.01,0.02,0.05 npx hardhat run scripts/tge/trade-sim.js --network <net>
 *
 * 각 비율은 USDT 리저브 대비 매수 규모. 매수 후 받은 SL 을 그대로 되팔아 풀을 원상 복구한다(수수료만큼만 변함).
 * 심도: 가격을 +2% 올리는 데 필요한 USDT / −2% 내리는 데 필요한 SL (풀 수수료 반영, 이분 탐색).
 */
const hre = require("hardhat");
const { ethers } = hre;
const L = require("./lib");

function outGivenIn(amtIn, rIn, rOut, feeBps) {
  const inWithFee = amtIn * BigInt(10000 - feeBps);
  return (inWithFee * rOut) / (rIn * 10000n + inWithFee);
}
function depthFor(rIn, rOut, feeBps, targetRatio /* new price / old price as float, e.g. 1.02 */) {
  // price(out per in) after buying with x: (rIn+x)/(rOut-out). 이분 탐색.
  let lo = 0n, hi = rIn; // 리저브만큼 넣으면 가격은 4배 이상 오르므로 충분
  const p0 = Number(rIn) / Number(rOut);
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2n;
    const out = outGivenIn(mid, rIn, rOut, feeBps);
    const p1 = Number(rIn + mid) / Number(rOut - out);
    if (p1 / p0 < targetRatio) lo = mid; else hi = mid;
  }
  return hi;
}

async function main() {
  const [signer] = await ethers.getSigners();
  const dex = await L.resolveDex();
  const tokenAddr = L.tokenAddress();
  const usdt = new ethers.Contract(dex.usdt, L.ERC20_ABI, signer);
  const sl = new ethers.Contract(tokenAddr, L.ERC20_ABI, signer);
  const usdtDec = Number(await usdt.decimals());
  const router = new ethers.Contract(dex.router, L.ROUTER_ABI, signer);
  const fracs = (process.env.TRADE_FRACTIONS || "0.001,0.005,0.01,0.02,0.05").split(",").map(Number);

  let info = await L.pairInfo(dex, tokenAddr, signer);
  if (!info.exists) throw new Error("페어 없음");
  const p0 = L.priceOf(info.rSL, info.rUSDT, usdtDec);
  console.log(`TRADE SIM — ${dex.name}  pair ${info.pairAddr}  fee ${dex.feeBps} bps`);
  console.log(`  시작 reserves SL ${L.fmt(info.rSL)} / USDT ${L.fmt(info.rUSDT, usdtDec)} → ${p0.toPrecision(6)} USDT/SL`);

  const up = depthFor(info.rUSDT, info.rSL, dex.feeBps, 1.02);
  const down = depthFor(info.rSL, info.rUSDT, dex.feeBps, 1.02);
  console.log(`  +2% 심도 ≈ ${L.fmt(up, usdtDec)} USDT 매수   −2% 심도 ≈ ${L.fmt(down)} SL 매도 (≈ ${L.fmt((down * info.rUSDT) / info.rSL, usdtDec)} USDT)`);

  console.log("\n  비율      매수 USDT        받은 SL        체결가       임팩트   되판 뒤 가격");
  const rows = [];
  for (const f of fracs) {
    info = await L.pairInfo(dex, tokenAddr, signer);
    const pBefore = L.priceOf(info.rSL, info.rUSDT, usdtDec);
    const x = (info.rUSDT * BigInt(Math.round(f * 1e6))) / 1000000n;
    if (x === 0n) continue;
    const bal = await usdt.balanceOf(signer.address);
    if (bal < x) { console.log(`  ${f}: USDT 잔고 부족(${L.fmt(bal, usdtDec)}) — 건너뜀`); continue; }

    await L.approveExact(dex.usdt, dex.router, x, signer);
    const quote = await router.getAmountsOut(x, [dex.usdt, tokenAddr]);
    const slBefore = await sl.balanceOf(signer.address);
    await (await router.swapExactTokensForTokens(x, (quote[1] * 99n) / 100n, [dex.usdt, tokenAddr], signer.address, await L.deadline())).wait();
    const got = (await sl.balanceOf(signer.address)) - slBefore;
    const exec = Number(ethers.formatUnits(x, usdtDec)) / Number(ethers.formatUnits(got, 18));
    const impact = (exec / pBefore - 1) * 100;

    // 되팔기
    await L.approveExact(tokenAddr, dex.router, got, signer);
    await (await router.swapExactTokensForTokens(got, 0, [tokenAddr, dex.usdt], signer.address, await L.deadline())).wait();
    info = await L.pairInfo(dex, tokenAddr, signer);
    const pAfter = L.priceOf(info.rSL, info.rUSDT, usdtDec);
    rows.push({ f, x, got, exec, impact, pAfter });
    console.log(
      `  ${String(f).padEnd(8)} ${L.fmt(x, usdtDec).padStart(14)} ${L.fmt(got).padStart(14)} ${exec.toPrecision(6).padStart(11)} ${impact.toFixed(2).padStart(7)}%  ${pAfter.toPrecision(6)}`
    );
  }
  await L.revoke(tokenAddr, dex.router, signer);
  await L.revoke(dex.usdt, dex.router, signer);

  L.mergeJson(L.files.dex(), {
    tradeSim: {
      at: new Date().toISOString(),
      startPrice: p0,
      depthUpUsdt: up.toString(),
      depthDownSl: down.toString(),
      rows: rows.map((r) => ({ fraction: r.f, usdtIn: r.x.toString(), slOut: r.got.toString(), execPrice: r.exec, impactPct: r.impact, priceAfterRoundTrip: r.pAfter })),
    },
  });
  console.log(`\n저장: deployments/${hre.network.name}.dex.json (tradeSim)`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
