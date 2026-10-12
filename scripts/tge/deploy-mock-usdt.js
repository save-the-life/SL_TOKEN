/**
 * MockUSDT 만 배포 (BSC 테스트넷처럼 DEX 는 있지만 정식 USDT 가 없는 곳)
 *
 *   npx hardhat run scripts/tge/deploy-mock-usdt.js --network bscTestnet
 *
 * 배포자에게 MOCK_USDT_MINT(기본 100,000,000) 를 민팅하고 deployments/<network>.dex.json 의 usdt 에 기록한다.
 */
const hre = require("hardhat");
const { ethers } = hre;
const L = require("./lib");

async function main() {
  const [deployer] = await ethers.getSigners();
  const Mock = await ethers.getContractFactory("MockUSDT");
  const usdt = await Mock.deploy();
  await usdt.waitForDeployment();
  const addr = await usdt.getAddress();
  const amt = ethers.parseUnits(process.env.MOCK_USDT_MINT || "100000000", 18);
  await (await usdt.mint(deployer.address, amt)).wait();
  L.mergeJson(L.files.dex(), { usdt: addr, usdtSource: "MockUSDT", usdtMintedAt: new Date().toISOString() });
  console.log("MockUSDT:", addr, `→ ${ethers.formatUnits(amt, 18)} 민팅 (${deployer.address})`);
  console.log(`저장: deployments/${hre.network.name}.dex.json`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
