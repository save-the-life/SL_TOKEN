/**
 * 모니터링 봇 최소판 — 풀 가격·±2% 심도·대량 이동(공급의 ALERT_BPS 이상 단일 전송)을 주기적으로 기록/알림.
 *
 *   INTERVAL_MS=30000 ALERT_BPS=50 npx hardhat run scripts/tge/monitor.js --network <net>
 *
 *   - TG_BOT_TOKEN / TG_CHAT_ID 가 있으면 텔레그램으로도 보낸다(없으면 콘솔만).
 *   - RUN_SECONDS 를 주면 그 시간 뒤 종료(테스트용). 기본은 Ctrl+C 까지.
 *   - 로그: deployments/<network>.monitor.log (JSON lines)
 */
const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");
const L = require("./lib");

function outGivenIn(amtIn, rIn, rOut, feeBps) {
  const inWithFee = amtIn * BigInt(10000 - feeBps);
  return (inWithFee * rOut) / (rIn * 10000n + inWithFee);
}
function depthFor(rIn, rOut, feeBps, ratio) {
  let lo = 0n, hi = rIn;
  const p0 = Number(rIn) / Number(rOut);
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2n;
    const out = outGivenIn(mid, rIn, rOut, feeBps);
    const p1 = Number(rIn + mid) / Number(rOut - out);
    if (p1 / p0 < ratio) lo = mid; else hi = mid;
  }
  return hi;
}

async function notify(text) {
  console.log("🔔", text);
  const { TG_BOT_TOKEN, TG_CHAT_ID } = process.env;
  if (!TG_BOT_TOKEN || !TG_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: TG_CHAT_ID, text }),
    });
  } catch (e) {
    console.log("   (텔레그램 전송 실패:", e.message, ")");
  }
}

async function main() {
  const dex = await L.resolveDex();
  const tokenAddr = L.tokenAddress();
  const provider = ethers.provider;
  const token = new ethers.Contract(tokenAddr, L.ERC20_ABI, provider);
  const usdt = new ethers.Contract(dex.usdt, L.ERC20_ABI, provider);
  const usdtDec = Number(await usdt.decimals());
  const interval = Number(process.env.INTERVAL_MS || 30000);
  const alertBps = BigInt(process.env.ALERT_BPS || 50);
  const runSecs = Number(process.env.RUN_SECONDS || 0);
  const logFile = path.join(__dirname, "..", "..", "deployments", `${hre.network.name}.monitor.log`);
  fs.mkdirSync(path.dirname(logFile), { recursive: true });

  const supply = await token.totalSupply();
  const threshold = (supply * alertBps) / 10000n;
  let lastBlock = await provider.getBlockNumber();
  let lastPrice = null;
  const started = Date.now();
  console.log(`MONITOR — ${dex.name}  token ${tokenAddr}  interval ${interval}ms  대량 이동 기준 ${L.fmt(threshold)} SL (${Number(alertBps) / 100}% of supply)`);
  await notify(`[SL monitor] 시작 ${dex.name} token ${tokenAddr}`);

  const tick = async () => {
    const info = await L.pairInfo(dex, tokenAddr, provider);
    const now = new Date().toISOString();
    const rec = { t: now, block: await provider.getBlockNumber() };
    if (info.exists && info.rSL > 0n) {
      const price = L.priceOf(info.rSL, info.rUSDT, usdtDec);
      const up = depthFor(info.rUSDT, info.rSL, dex.feeBps, 1.02);
      const down = depthFor(info.rSL, info.rUSDT, dex.feeBps, 1.02);
      Object.assign(rec, { price, rSL: info.rSL.toString(), rUSDT: info.rUSDT.toString(), depthUpUsdt: up.toString(), depthDownSl: down.toString() });
      console.log(`${now}  price ${price.toPrecision(6)}  +2% ${L.fmt(up, usdtDec)} USDT  −2% ${L.fmt(down)} SL  reserves ${L.fmt(info.rSL)} SL / ${L.fmt(info.rUSDT, usdtDec)} USDT`);
      if (lastPrice !== null && Math.abs(price / lastPrice - 1) >= 0.05) {
        await notify(`[SL monitor] 가격 급변 ${lastPrice.toPrecision(6)} → ${price.toPrecision(6)} (${((price / lastPrice - 1) * 100).toFixed(1)}%)`);
      }
      lastPrice = price;
    } else {
      console.log(`${now}  페어 없음/빈 페어`);
    }
    // 대량 이동 — 공개 RPC 는 eth_getLogs 범위·횟수를 제한하므로 최대 50블록씩, 실패해도 봇은 죽지 않는다
    const cur = rec.block;
    if (cur > lastBlock) {
      const to = Math.min(cur, lastBlock + 50);
      try {
        const evs = await token.queryFilter(token.filters.Transfer(), lastBlock + 1, to);
        for (const ev of evs) {
          const v = ev.args.value;
          if (v >= threshold) {
            await notify(`[SL monitor] 대량 이동 ${L.fmt(v)} SL  ${ev.args.from} → ${ev.args.to}  tx ${ev.transactionHash}`);
            rec.alerts = (rec.alerts || []).concat(ev.transactionHash);
          }
        }
        lastBlock = to;
      } catch (e) {
        rec.logError = (e.shortMessage || e.message || "").slice(0, 80);
        console.log(`   (getLogs ${lastBlock + 1}-${to} 실패: ${rec.logError} — 다음 주기에 재시도)`);
        if (cur - lastBlock > 500) lastBlock = cur - 50; // 너무 뒤처지면 최근 구간만 본다
      }
    }
    fs.appendFileSync(logFile, JSON.stringify(rec) + "\n");
  };

  try {
    await tick();
  } catch (e) {
    console.log("첫 tick 오류:", e.message);
  }
  await new Promise((resolve) => {
    const h = setInterval(async () => {
      try {
        await tick();
      } catch (e) {
        console.log("tick 오류:", e.message);
      }
      if (runSecs && Date.now() - started >= runSecs * 1000) {
        clearInterval(h);
        resolve();
      }
    }, interval);
  });
  console.log("종료 (RUN_SECONDS)");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
