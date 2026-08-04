const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const cfg = require("../config/allocations");

const DECIMALS = 18n;
const toWei = (whole) => BigInt(whole) * 10n ** DECIMALS;
const MONTH = 30n * 24n * 60n * 60n;

describe("SL Token 얼로케이션 & 베스팅 (감사 대응 반영)", function () {
  let token, vesting, deployer, alice, bob, tge;

  beforeEach(async function () {
    [deployer, alice, bob] = await ethers.getSigners();

    const SLToken = await ethers.getContractFactory("SLToken");
    token = await SLToken.deploy(deployer.address);
    await token.waitForDeployment();

    const SLVesting = await ethers.getContractFactory("SLVesting");
    vesting = await SLVesting.deploy(await token.getAddress(), deployer.address);
    await vesting.waitForDeployment();

    // (High 2) start는 미래여야 하므로 TGE를 "현재 + 버퍼"로 잡는다.
    const nowTs = BigInt((await ethers.provider.getBlock("latest")).timestamp);
    tge = nowTs + 3600n;
  });

  it("초기 발행량 20억, totalSupply와 일치", async function () {
    expect(await token.INITIAL_SUPPLY()).to.equal(toWei("2000000000"));
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
        // (Med 3) 스케줄 생성 전에 자금을 먼저 넣어야 함
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

    // 소각 후 총공급량 = 20억 - Protocol Reserve(100M)
    expect(await token.totalSupply()).to.equal(toWei("2000000000") - burnTotal);
    // 베스팅 컨트랙트가 베스팅 합계만큼 보유
    expect(await token.balanceOf(vestingAddr)).to.equal(vestingTotal);
    // 커밋 총액도 베스팅 합계와 일치
    expect(await vesting.totalCommitted()).to.equal(vestingTotal);
    // 스케줄 개수 = vesting 타입 버킷 수
    const vestingCount = cfg.buckets.filter((b) => b.type === "vesting").length;
    expect(await vesting.scheduleCount()).to.equal(vestingCount);
  });

  it("Team: TGE 0%, 12개월 클리프 동안 0, 이후 36개월 선형, 종료 후 전량", async function () {
    const amount = toWei("300000000");
    await token.transfer(await vesting.getAddress(), amount);
    const id = ethers.id("TEAM");
    await vesting.createSchedule(id, alice.address, amount, tge, 12n * MONTH, 36n * MONTH, 0);

    // 생성 직후(start 이전): 0
    expect(await vesting.releasable(id)).to.equal(0n);

    // 11개월 후: 아직 클리프 안, 0
    await time.increaseTo(tge + 11n * MONTH);
    expect(await vesting.releasable(id)).to.equal(0n);

    // 12 + 18 = 클리프 후 선형 절반 → 총량의 약 50%
    await time.increaseTo(tge + 12n * MONTH + 18n * MONTH);
    expect(await vesting.releasable(id)).to.be.closeTo(amount / 2n, toWei("1000"));

    // 12 + 36 = 48개월 후: 전량
    await time.increaseTo(tge + 48n * MONTH + 1n);
    expect(await vesting.releasable(id)).to.equal(amount);
  });

  it("Treasury: TGE 3% 즉시 해제, 6개월 클리프 동안 3% 유지, 30개월 후 100%", async function () {
    const amount = toWei("400000000");
    await token.transfer(await vesting.getAddress(), amount);
    const id = ethers.id("TREASURY");
    // TGE 3%, 6개월 클리프, 24개월 선형
    await vesting.createSchedule(id, alice.address, amount, tge, 6n * MONTH, 24n * MONTH, 300);

    // 생성 직후(start 이전): 0
    expect(await vesting.releasable(id)).to.equal(0n);

    // TGE 시점 도달: 3%
    await time.increaseTo(tge);
    expect(await vesting.releasable(id)).to.be.closeTo((amount * 3n) / 100n, toWei("100"));

    // 6개월(클리프 끝) 시점: 여전히 ~3% (선형 시작 지점)
    await time.increaseTo(tge + 6n * MONTH);
    expect(await vesting.releasable(id)).to.be.closeTo((amount * 3n) / 100n, toWei("100"));

    // 6 + 24 = 30개월 후: 전량
    await time.increaseTo(tge + 30n * MONTH + 1n);
    expect(await vesting.releasable(id)).to.equal(amount);
  });

  it("release(): Marketing TGE 20% + 12개월 선형, 수혜 지갑으로 전송·누적", async function () {
    const amount = toWei("100000000");
    await token.transfer(await vesting.getAddress(), amount);
    const id = ethers.id("MARKETING");
    // TGE 20%, cliff 0, linear 12개월
    await vesting.createSchedule(id, alice.address, amount, tge, 0n, 12n * MONTH, 2000);

    // TGE 시점 도달 후 청구 → 약 20%
    await time.increaseTo(tge);
    await vesting.release(id);
    expect(await token.balanceOf(alice.address)).to.be.closeTo((amount * 20n) / 100n, toWei("100"));

    // 6개월 후 다시 청구 → 누적 약 20% + 80%*0.5 = 60%
    await time.increaseTo(tge + 6n * MONTH);
    await vesting.release(id);
    const expected = (amount * 20n) / 100n + ((amount * 80n) / 100n) / 2n;
    expect(await token.balanceOf(alice.address)).to.be.closeTo(expected, toWei("2000"));
  });

  it("(High 2) 과거 start로 스케줄 생성 시 revert", async function () {
    const amount = toWei("1000000");
    await token.transfer(await vesting.getAddress(), amount);
    const past = tge - 100n * MONTH;
    await expect(
      vesting.createSchedule(ethers.id("PAST"), alice.address, amount, past, 0n, 12n * MONTH, 0)
    ).to.be.revertedWith("start in past");
  });

  it("(Med 3) 자금 없이 스케줄 생성 시 revert", async function () {
    const amount = toWei("100000000");
    await expect(
      vesting.createSchedule(ethers.id("NOFUND"), alice.address, amount, tge, 0n, 12n * MONTH, 0)
    ).to.be.revertedWith("underfunded");
  });

  it("(Low 6) sweep은 커밋되지 않은 잉여분만 회수", async function () {
    const sched = toWei("100000000");
    const extra = toWei("5000000");
    await token.transfer(await vesting.getAddress(), sched + extra);
    await vesting.createSchedule(ethers.id("ECOSYSTEM"), alice.address, sched, tge, 12n * MONTH, 36n * MONTH, 0);

    const before = await token.balanceOf(deployer.address);
    await vesting.sweep(deployer.address);
    const after = await token.balanceOf(deployer.address);
    expect(after - before).to.equal(extra); // 잉여만 회수

    // 남은 잉여 없음 → revert
    await expect(vesting.sweep(deployer.address)).to.be.revertedWith("no surplus");
  });

  it("(High 1) updateBeneficiary는 변경 전 기존 수혜자에게 정산", async function () {
    const amount = toWei("100000000");
    await token.transfer(await vesting.getAddress(), amount);
    const id = ethers.id("MKT2");
    await vesting.createSchedule(id, alice.address, amount, tge, 0n, 12n * MONTH, 2000);

    // 6개월 경과 → 누적 약 60% 청구 가능
    await time.increaseTo(tge + 6n * MONTH);

    const aliceBefore = await token.balanceOf(alice.address);
    await vesting.updateBeneficiary(id, bob.address);
    const aliceAfter = await token.balanceOf(alice.address);
    // 변경 시점에 alice에게 ~60% 정산됨
    expect(aliceAfter - aliceBefore).to.be.closeTo((amount * 60n) / 100n, toWei("2000"));

    // 이후 잔여(~40%)는 bob에게
    await time.increaseTo(tge + 12n * MONTH + 1n);
    await vesting.release(id);
    expect(await token.balanceOf(bob.address)).to.be.closeTo((amount * 40n) / 100n, toWei("2000"));
  });
});
