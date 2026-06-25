const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const cfg = require("../config/allocations");

const DECIMALS = 18n;
const toWei = (whole) => BigInt(whole) * 10n ** DECIMALS;
const MONTH = 30n * 24n * 60n * 60n;

describe("SL Token 얼로케이션 & 베스팅", function () {
  let token, vesting, deployer, alice, tge;

  beforeEach(async function () {
    [deployer, alice] = await ethers.getSigners();

    const SLToken = await ethers.getContractFactory("SLToken");
    token = await SLToken.deploy(deployer.address);
    await token.waitForDeployment();

    const SLVesting = await ethers.getContractFactory("SLVesting");
    vesting = await SLVesting.deploy(await token.getAddress(), deployer.address);
    await vesting.waitForDeployment();

    tge = BigInt((await ethers.provider.getBlock("latest")).timestamp);
  });

  it("총 발행량은 정확히 20억", async function () {
    expect(await token.totalSupply()).to.equal(toWei("2000000000"));
  });

  it("얼로케이션 버킷 합계가 총발행량과 일치", async function () {
    let sum = 0n;
    for (const b of cfg.buckets) sum += BigInt(b.amount);
    expect(sum).to.equal(BigInt(cfg.totalSupply));
  });

  it("전체 분배 실행: direct/burn/vesting이 의도대로 처리됨", async function () {
    const vestingAddr = await vesting.getAddress();
    let vestingTotal = 0n;
    let burnTotal = 0n;

    for (const b of cfg.buckets) {
      const amount = toWei(b.amount);
      const wallet = b.wallet || deployer.address;
      if (b.type === "burn") {
        await token.burn(amount);
        burnTotal += amount;
      } else if (b.type === "direct") {
        await token.transfer(wallet, amount);
      } else {
        await token.transfer(vestingAddr, amount);
        await vesting.createSchedule(
          ethers.id(b.key),
          wallet,
          amount,
          tge,
          BigInt(b.cliffMonths) * MONTH,
          BigInt(b.durationMonths) * MONTH,
          b.tgeBps
        );
        vestingTotal += amount;
      }
    }

    // 소각 후 총공급량 = 20억 - BurnReserve(60M)
    expect(await token.totalSupply()).to.equal(toWei("2000000000") - burnTotal);
    // 베스팅 컨트랙트가 베스팅 합계만큼 보유
    expect(await token.balanceOf(vestingAddr)).to.equal(vestingTotal);
    // 스케줄 개수 = vesting 타입 버킷 수
    const vestingCount = cfg.buckets.filter((b) => b.type === "vesting").length;
    expect(await vesting.scheduleCount()).to.equal(vestingCount);
  });

  it("Team: TGE 0%, 12개월 클리프 동안 0, 이후 36개월 선형, 종료 후 전량", async function () {
    const amount = toWei("300000000");
    await token.transfer(await vesting.getAddress(), amount);
    const id = ethers.id("TEAM");
    await vesting.createSchedule(id, alice.address, amount, tge, 12n * MONTH, 36n * MONTH, 0);

    // TGE 직후: 0
    expect(await vesting.releasable(id)).to.equal(0n);

    // 11개월 후: 아직 클리프 안, 0
    await time.increaseTo(tge + 11n * MONTH);
    expect(await vesting.releasable(id)).to.equal(0n);

    // 12개월 + 18개월 = 클리프 후 선형 절반 → 총량의 약 50%
    await time.increaseTo(tge + 12n * MONTH + 18n * MONTH);
    const half = await vesting.releasable(id);
    expect(half).to.be.closeTo(amount / 2n, toWei("1000")); // 오차 1000 SL 이내

    // 12 + 36 = 48개월 후: 전량
    await time.increaseTo(tge + 48n * MONTH + 1n);
    expect(await vesting.releasable(id)).to.equal(amount);
  });

  it("Seed: TGE 5% 즉시 해제, 클리프 동안 5% 유지, 종료 후 100%", async function () {
    const amount = toWei("15000000");
    await token.transfer(await vesting.getAddress(), amount);
    const id = ethers.id("SEED");
    await vesting.createSchedule(id, alice.address, amount, tge, 6n * MONTH, 18n * MONTH, 500);

    // TGE 직후: 5%
    expect(await vesting.releasable(id)).to.equal((amount * 5n) / 100n);

    // 6개월(클리프 끝) 시점: 여전히 5% (선형 시작 지점)
    await time.increaseTo(tge + 6n * MONTH);
    expect(await vesting.releasable(id)).to.be.closeTo((amount * 5n) / 100n, toWei("100"));

    // 6 + 18 = 24개월 후: 전량
    await time.increaseTo(tge + 24n * MONTH + 1n);
    expect(await vesting.releasable(id)).to.equal(amount);
  });

  it("release() 호출 시 수혜 지갑으로 전송되고 released가 누적됨", async function () {
    const amount = toWei("100000000"); // Marketing 가정
    await token.transfer(await vesting.getAddress(), amount);
    const id = ethers.id("MARKETING");
    // TGE 15%, cliff 0, linear 12개월
    await vesting.createSchedule(id, alice.address, amount, tge, 0n, 12n * MONTH, 1500);

    // TGE 직후 청구 → 약 15% (cliff 0이라 트랜잭션 1~2초 사이 선형분이 미세하게 쌓임)
    await vesting.release(id);
    expect(await token.balanceOf(alice.address)).to.be.closeTo((amount * 15n) / 100n, toWei("100"));

    // 6개월 후 다시 청구 → 추가분 수령(누적 약 15% + 85%*0.5)
    await time.increaseTo(tge + 6n * MONTH);
    await vesting.release(id);
    const bal = await token.balanceOf(alice.address);
    const expected = (amount * 15n) / 100n + ((amount * 85n) / 100n) / 2n;
    expect(bal).to.be.closeTo(expected, toWei("2000"));
  });
});
