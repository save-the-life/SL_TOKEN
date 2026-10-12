/**
 * PancakeSwap v2 SL/USDT 유동성 공급 (페어 생성 + 초기 가격 설정을 한 tx 로)
 *
 *   SL_AMOUNT=1000000 USDT_AMOUNT=10000 npx hardhat run scripts/tge/add-liquidity-v2.js --network <net>
 *
 * 안전장치
 *   - 페어가 이미 있고 유동성이 있으면(선점) 목표 가격과 2% 이상 다를 때 중단한다.
 *     ALIGN=1 이면 constant-product 계산으로 스왑해 가격을 목표에 맞춘 뒤(최대 3회) 진행.
 *   - 승인은 정확한 수량만, 끝나면 잔여 승인 0 으로 revoke.
 *   - amountMin = 수량 × (1 − SLIPPAGE_BPS/10000), 기본 2%.
 *
 * 결과는 deployments/<network>.dex.json 에 pair / tx / LP 잔고로 기록된다.
 */
const hre = require("hardhat");
const { ethers } = hre;
const L = require("./lib");

async function alignPrice(dex, tokenAddr, signer, targetPrice, usdtDec) {
  const router = new ethers.Contract(dex.router, L.ROUTER_ABI, signer);
  const TS = BigInt(Math.round(targetPrice * 1e18)); // target × 1e18
  const D = 10n ** BigInt(usdtDec);
  for (let i = 0; i < 3; i++) {
    const info = await L.pairInfo(dex, tokenAddr, signer);
    const cur = L.priceOf(info.rSL, info.rUSDT, usdtDec);
    const dev = cur / targetPrice - 1;
    console.log(`   정렬 ${i + 1}: 현재 ${cur.toPrecision(6)} / 목표 ${targetPrice} (편차 ${(dev * 100).toFixed(2)}%)`);
    if (Math.abs(dev) <= 0.01) break;
    const k = info.rSL * info.rUSDT;
    if (cur < targetPrice) {
      // USDT 로 SL 매수: rU' = sqrt(k · P_raw),  P_raw = TS·10^d / 10^36
      const rUt = L.sqrtBig((k * TS * D) / 10n ** 36n);
      const x = rUt - info.rUSDT;
      if (x <= 0n) break;
      await L.approveExact(dex.usdt, dex.router, x, signer);
      await (await router.swapExactTokensForTokens(x, 0, [dex.usdt, tokenAddr], signer.address, await L.deadline())).wait();
      console.log(`   → ${L.fmt(x, usdtDec)} USDT 로 SL 매수`);
    } else {
      // SL 매도: rS' = sqrt(k / P_raw)
      const rSt = L.sqrtBig((k * 10n ** 36n) / (TS * D));
      const y = rSt - info.rSL;
      if (y <= 0n) break;
      await L.approveExact(tokenAddr, dex.router, y, signer);
      await (await router.swapExactTokensForTokens(y, 0, [tokenAddr, dex.usdt], signer.address, await L.deadline())).wait();
      console.log(`   → ${L.fmt(y)} SL 매도`);
    }
  }
  await L.revoke(tokenAddr, dex.router, signer);
  await L.revoke(dex.usdt, dex.router, signer);
}

async function main() {
  const [signer] = await ethers.getSigners();
  const dex = await L.resolveDex();
  const tokenAddr = L.tokenAddress();
  const sl = new ethers.Contract(tokenAddr, L.ERC20_ABI, signer);
  const usdt = new ethers.Contract(dex.usdt, L.ERC20_ABI, signer);
  const usdtDec = Number(await usdt.decimals());

  const slStr = process.env.SL_AMOUNT || "1000000";
  const usdtStr = process.env.USDT_AMOUNT || "10000";
  const slAmt = ethers.parseUnits(slStr, 18);
  const usdtAmt = ethers.parseUnits(usdtStr, usdtDec);
  const target = Number(usdtStr) / Number(slStr);
  const slipBps = BigInt(process.env.SLIPPAGE_BPS || "200");
  const recipient = process.env.LP_RECIPIENT || signer.address;
  const align = process.env.ALIGN === "1";

  console.log(`ADD LIQUIDITY — ${dex.name} (chainId ${dex.chainId}) router ${dex.router}`);
  console.log(`  SL ${tokenAddr}  USDT ${dex.usdt} (${usdtDec} dec)`);
  console.log(`  공급 ${L.fmt(slAmt)} SL + ${L.fmt(usdtAmt, usdtDec)} USDT → 목표 가격 ${target} USDT/SL`);

  const [bSL, bU] = await Promise.all([sl.balanceOf(signer.address), usdt.balanceOf(signer.address)]);
  if (bSL < slAmt || bU < usdtAmt) {
    throw new Error(`잔고 부족: SL ${L.fmt(bSL)} / USDT ${L.fmt(bU, usdtDec)}`);
  }

  // 1) 페어 상태
  let info = await L.pairInfo(dex, tokenAddr, signer);
  if (info.exists && (info.rSL > 0n || info.rUSDT > 0n)) {
    const cur = L.priceOf(info.rSL, info.rUSDT, usdtDec);
    const dev = Math.abs(cur / target - 1) * 100;
    console.log(`\n⚠️  페어가 이미 존재하고 유동성이 있습니다: ${info.pairAddr}`);
    console.log(`   reserves  SL ${L.fmt(info.rSL)} / USDT ${L.fmt(info.rUSDT, usdtDec)}`);
    console.log(`   현재 가격 ${cur.toPrecision(6)} USDT/SL, 목표 ${target}, 편차 ${dev.toFixed(2)}%`);
    if (dev > 2) {
      if (!align) {
        console.log("\n❌ 중단: 선점된 풀의 가격이 목표와 다릅니다. 유동성을 넣지 않았습니다.");
        console.log("   런북 절차: 선점 풀 확인 → 가격 정렬 → amountMin 지정 후 재실행 (ALIGN=1 로 자동 정렬 가능)");
        process.exitCode = 3;
        return;
      }
      console.log("\n🔧 ALIGN=1 — 가격 정렬 스왑 시작");
      await alignPrice(dex, tokenAddr, signer, target, usdtDec);
      info = await L.pairInfo(dex, tokenAddr, signer);
      const cur2 = L.priceOf(info.rSL, info.rUSDT, usdtDec);
      const dev2 = Math.abs(cur2 / target - 1) * 100;
      if (dev2 > 2) throw new Error(`정렬 후에도 편차 ${dev2.toFixed(2)}% — 수동 확인 필요`);
      console.log(`   정렬 완료: ${cur2.toPrecision(6)} USDT/SL (편차 ${dev2.toFixed(2)}%)`);
    }
  } else {
    console.log("\n✅ 페어 없음(또는 빈 페어) → 이 tx 가 페어를 만들고 초기 가격을 정합니다");
  }

  // 2) 정확 수량 승인
  await L.approveExact(tokenAddr, dex.router, slAmt, signer);
  await L.approveExact(dex.usdt, dex.router, usdtAmt, signer);

  // 3) addLiquidity
  const router = new ethers.Contract(dex.router, L.ROUTER_ABI, signer);
  const minSL = (slAmt * (10000n - slipBps)) / 10000n;
  const minU = (usdtAmt * (10000n - slipBps)) / 10000n;
  const tx = await router.addLiquidity(tokenAddr, dex.usdt, slAmt, usdtAmt, minSL, minU, recipient, await L.deadline());
  const rc = await tx.wait();

  // 4) 결과
  info = await L.pairInfo(dex, tokenAddr, signer);
  const lpBal = await info.pair.balanceOf(recipient);
  const price = L.priceOf(info.rSL, info.rUSDT, usdtDec);
  console.log(`\n✅ 유동성 공급 완료  block ${rc.blockNumber}  tx ${rc.hash}`);
  console.log(`   pair ${info.pairAddr}`);
  console.log(`   reserves  SL ${L.fmt(info.rSL)} / USDT ${L.fmt(info.rUSDT, usdtDec)}  → ${price.toPrecision(6)} USDT/SL`);
  console.log(`   LP 잔고(${recipient}): ${L.fmt(lpBal)}`);

  // 5) 승인 회수
  const r1 = await L.revoke(tokenAddr, dex.router, signer);
  const r2 = await L.revoke(dex.usdt, dex.router, signer);
  console.log(`   승인 회수: SL ${L.fmt(r1)} → 0, USDT ${L.fmt(r2, usdtDec)} → 0`);

  L.mergeJson(L.files.dex(), {
    router: dex.router,
    factory: dex.factory,
    usdt: dex.usdt,
    token: tokenAddr,
    pair: info.pairAddr,
    addLiquidityTx: rc.hash,
    addLiquidityBlock: rc.blockNumber,
    lpRecipient: recipient,
    lpBalance: lpBal.toString(),
    initialPrice: price,
  });
  console.log(`저장: deployments/${hre.network.name}.dex.json`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
