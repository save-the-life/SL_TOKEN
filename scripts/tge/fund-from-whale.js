/**
 * (포크 전용) 실제 USDT 고래 계정을 impersonate 해서 배포자에게 USDT 를 보낸다.
 *
 *   DEX=bsc WHALE_USDT=1000000 npx hardhat run scripts/tge/fund-from-whale.js --network localhost
 *
 * 포크가 아닌 실제 체인에서는 impersonate 가 실패하므로 안전하다.
 */
const hre = require("hardhat");
const { ethers } = hre;
const L = require("./lib");

async function main() {
  const [deployer] = await ethers.getSigners();
  const dex = await L.resolveDex();
  const whale = process.env.WHALE_ADDR || dex.whale;
  if (!whale) throw new Error("이 체인에 whale 주소가 없습니다 (WHALE_ADDR 지정)");
  const usdt = new ethers.Contract(dex.usdt, L.ERC20_ABI, deployer);
  const dec = Number(await usdt.decimals());
  const amount = ethers.parseUnits(process.env.WHALE_USDT || "1000000", dec);

  const whaleBal = await usdt.balanceOf(whale);
  console.log(`whale ${whale} USDT 잔고: ${L.fmt(whaleBal, dec)}`);
  if (whaleBal < amount) throw new Error("whale 잔고가 요청량보다 적습니다 — WHALE_ADDR 를 다른 대형 보유 주소로");

  await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [whale] });
  await hre.network.provider.send("hardhat_setBalance", [whale, "0x56BC75E2D63100000"]); // 100 BNB 가스
  const ws = await ethers.getSigner(whale);
  const tx = await usdt.connect(ws).transfer(deployer.address, amount);
  await tx.wait();
  await hre.network.provider.request({ method: "hardhat_stopImpersonatingAccount", params: [whale] });

  console.log(`✅ ${L.fmt(amount, dec)} USDT → ${deployer.address}  (${tx.hash})`);
  console.log(`배포자 USDT 잔고: ${L.fmt(await usdt.balanceOf(deployer.address), dec)}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
