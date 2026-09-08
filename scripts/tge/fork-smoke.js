// 포크 동작 확인: 실제 BSC USDT 의 decimals 와 고래 잔고를 읽는다 (읽기 전용)
const hre = require("hardhat");
const { ethers } = hre;
async function main() {
  const usdt = new ethers.Contract("0x55d398326f99059fF775485246999027B3197955", ["function decimals() view returns (uint8)", "function balanceOf(address) view returns (uint256)"], ethers.provider);
  const bn = await ethers.provider.getBlockNumber();
  console.log("block", bn, "chainId", Number((await ethers.provider.getNetwork()).chainId));
  console.log("USDT decimals", await usdt.decimals(), "whale", ethers.formatUnits(await usdt.balanceOf("0xF977814e90dA44bFA03b6295A0616a897441aceC"), 18));
}
main().catch((e) => { console.error("SMOKE FAIL:", (e.shortMessage || e.message).split("\n")[0]); process.exitCode = 1; });
