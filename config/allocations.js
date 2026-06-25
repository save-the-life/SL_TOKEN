/**
 * SL Token 얼로케이션 & 베스팅 설정 (백서 v4.1 기준)
 *
 * - amount: 토큰 개수 (정수, 18 decimals 변환은 배포 스크립트가 처리)
 * - wallet: 해당 물량을 받을 지갑 주소. ""(빈 문자열)이면 배포 스크립트가 배포자 주소로 대체합니다.
 *           실제 분배 시 각 버킷의 실제 지갑 주소로 교체하세요.
 * - type:
 *     "vesting" → 베스팅 컨트랙트로 보내고 스케줄 생성 (tgeBps/cliffMonths/durationMonths 사용)
 *     "direct"  → 지갑으로 즉시 전량 전송 (예: 유동성 100% TGE)
 *     "burn"    → 영구 소각 (예: Burn Reserve)
 * - tgeBps: TGE 즉시 해제 비율 (basis points, 10000 = 100%)
 *
 * 총합 = 2,000,000,000 (20억)
 */
module.exports = {
  tokenName: "SL Token",
  tokenSymbol: "SL",
  totalSupply: "2000000000", // 20억

  buckets: [
    // key            라벨                amount(개)      type        tgeBps  cliff  linear  wallet
    { key: "SEED",        label: "Seed (기투자)",          amount: "15000000",  type: "vesting", tgeBps: 500,   cliffMonths: 6,  durationMonths: 18, wallet: "" },
    { key: "NODE1",       label: "노드세일 즉시 1차",       amount: "15000000",  type: "vesting", tgeBps: 1500,  cliffMonths: 0,  durationMonths: 8,  wallet: "" },
    { key: "NODE2",       label: "노드세일 즉시 2차",       amount: "15700000",  type: "vesting", tgeBps: 2500,  cliffMonths: 0,  durationMonths: 5,  wallet: "" },
    { key: "MINING",      label: "Community Mining",        amount: "600000000", type: "vesting", tgeBps: 0,     cliffMonths: 0,  durationMonths: 60, wallet: "" },
    { key: "AMBASSADOR",  label: "Ambassador",              amount: "140000000", type: "vesting", tgeBps: 0,     cliffMonths: 3,  durationMonths: 36, wallet: "" },
    { key: "TEAM",        label: "Team & Core",             amount: "300000000", type: "vesting", tgeBps: 0,     cliffMonths: 12, durationMonths: 36, wallet: "" },
    { key: "TREASURY",    label: "Treasury",                amount: "360000000", type: "vesting", tgeBps: 300,   cliffMonths: 6,  durationMonths: 24, wallet: "" },
    { key: "LIQUIDITY",   label: "Liquidity Pool",          amount: "160000000", type: "direct",  tgeBps: 10000, cliffMonths: 0,  durationMonths: 0,  wallet: "" },
    { key: "MARKETING",   label: "Marketing",               amount: "100000000", type: "vesting", tgeBps: 1500,  cliffMonths: 0,  durationMonths: 12, wallet: "" },
    { key: "ADVISORS",    label: "Advisors",                amount: "40000000",  type: "vesting", tgeBps: 0,     cliffMonths: 12, durationMonths: 24, wallet: "" },
    { key: "BURN",        label: "Burn Reserve",            amount: "60000000",  type: "burn",    tgeBps: 0,     cliffMonths: 0,  durationMonths: 0,  wallet: "" },
    { key: "POSTLISTING", label: "Post-Listing Strategic",  amount: "60000000",  type: "vesting", tgeBps: 0,     cliffMonths: 12, durationMonths: 24, wallet: "" },
    { key: "RESERVE",     label: "미배분 예비",             amount: "134300000", type: "direct",  tgeBps: 10000, cliffMonths: 0,  durationMonths: 0,  wallet: "" },
  ],
};
