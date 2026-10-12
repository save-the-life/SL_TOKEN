/**
 * Uniswap v2 아티팩트(팩토리·라우터·WETH9)로 PancakeSwap v2 와 같은 인터페이스의 DEX 사본을 배포한다.
 * 용도: (1) 로컬 hardhat 에서 스크립트 검증, (2) PancakeSwap 이 없는 opBNB 테스트넷에 정산 풀 리허설용 사본.
 * MockUSDT 도 함께 배포하고 배포자에게 1억 개를 민팅한다.
 *
 *   npx hardhat run scripts/tge/deploy-local-dex.js --network <localhost|opbnbTestnet>
 *
 * 주의: 사본은 라우터 라이브러리의 INIT_CODE_HASH 가 팩토리와 짝이 맞는 아티팩트를 그대로 쓰므로
 *       별도 수정이 필요 없다. 직접 PancakeSwap 소스를 컴파일해 배포할 때만 해시 교체가 필요하다.
 */
const hre = require("hardhat");
const { ethers } = hre;
const L = require("./lib");

const factoryArt = require("@uniswap/v2-core/build/UniswapV2Factory.json");
const routerArt = require("@uniswap/v2-periphery/build/UniswapV2Router02.json");
const wethArt = require("@uniswap/v2-periphery/build/WETH9.json");

const code = (a) => {
  const b = a.bytecode || (a.evm && a.evm.bytecode && a.evm.bytecode.object);
  if (!b) throw new Error("아티팩트에서 bytecode 를 찾지 못했습니다");
  return b.startsWith("0x") ? b : "0x" + b;
};

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("배포자:", deployer.address, "network:", hre.network.name);

  const weth = await new ethers.ContractFactory(wethArt.abi, code(wethArt), deployer).deploy();
  await weth.waitForDeployment();
  const factory = await new ethers.ContractFactory(factoryArt.abi, code(factoryArt), deployer).deploy(deployer.address);
  await factory.waitForDeployment();
  const router = await new ethers.ContractFactory(routerArt.abi, code(routerArt), deployer).deploy(
    await factory.getAddress(),
    await weth.getAddress()
  );
  await router.waitForDeployment();

  const Mock = await ethers.getContractFactory("MockUSDT");
  const usdt = await Mock.deploy();
  await usdt.waitForDeployment();
  await (await usdt.mint(deployer.address, ethers.parseUnits("100000000", 18))).wait();

  const out = {
    source: "uniswap-v2-artifacts (PancakeSwap v2 동일 인터페이스)",
    weth: await weth.getAddress(),
    factory: await factory.getAddress(),
    router: await router.getAddress(),
    usdt: await usdt.getAddress(),
    fee: 30,
    deployedAt: new Date().toISOString(),
  };
  L.mergeJson(L.files.dex(), out);
  console.log("DEX 사본 배포 완료:");
  console.log("  factory:", out.factory);
  console.log("  router :", out.router);
  console.log("  WETH   :", out.weth);
  console.log("  mUSDT  :", out.usdt, "(배포자에게 100,000,000 민팅)");
  console.log(`저장: deployments/${hre.network.name}.dex.json`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
