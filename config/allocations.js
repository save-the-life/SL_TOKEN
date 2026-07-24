/**
 * SL Token 얼로케이션 & 베스팅 설정 (최신 백서 기준 · 선형 베스팅)
 *
 * - amount: 토큰 개수 (정수, 18 decimals 변환은 배포 스크립트가 처리)
 * - wallet: 해당 물량을 받을 지갑 주소. ""(빈 문자열)이면 배포 스크립트가 배포자 주소로 대체합니다.
 *           실제 분배 시 각 버킷의 실제 지갑 주소(멀티시그 권장)로 교체하세요.
 * - type:
 *     "vesting" → 베스팅 컨트랙트로 보내고 스케줄 생성 (tgeBps/cliffMonths/durationMonths 사용, 선형 해제)
 *     "direct"  → 지갑으로 즉시 전량 전송 (예: 유동성 100% TGE, 관리 풀 배정)
 *     "burn"    → 영구 소각 (Protocol Reserve)
 * - tgeBps: TGE 즉시 해제 비율 (basis points, 10000 = 100%)
 * - cliffMonths: 클리프(잠금) 기간 (개월). 클리프 종료 후 선형 해제 시작.
 * - durationMonths: 클리프 이후 선형 해제 기간 (개월). 0이면 클리프 종료 시 잔량 전량 해제.
 *
 * ※ 모든 베스팅은 "클리프 + 선형(linear)" 방식입니다. 계단식(특정일 뭉텅이 해제)은 사용하지 않습니다.
 * ※ 총합 = 2,000,000,000 (20억)
 *
 * [주의: 컨트랙트가 담당하지 않는 부분 — 오프체인/별도 개발 필요]
 *  - Network Access Credit Pool(WCS 전환): 지금은 전용 지갑에 "배정만" 하며, WCS→SL 전환 로직은
 *    이후 별도 컨트랙트로 개발·감사 예정. (현재 direct 배정)
 *  - Participant Program(Ambassador): 3년간 활동 실적에 따른 분배는 재단이 오프체인으로 관리.
 *    (현재 direct로 관리 지갑에 배정)
 *  - Liquidity Pool: TGE에 전량 전송 후, DEX 유동성 공급으로 받는 LP 토큰은 24개월 락 (별도 락커).
 *  - Treasury / Ecosystem Reserve: 1년 락 후 선형 해제. 실제 사용은 재단 governance vote로 결정·공지(오프체인).
 */
module.exports = {
  tokenName: "SL Token",
  tokenSymbol: "SL",
  totalSupply: "2000000000", // 20억

  buckets: [
    // key          라벨                            amount(개)      type        tgeBps  cliff  linear  wallet
    { key: "NACP",        label: "Network Access Credit Pool", amount: "200000000", type: "direct",  tgeBps: 10000, cliffMonths: 0,  durationMonths: 0,  wallet: "" },
    { key: "PARTICIPANT", label: "Participant Program",        amount: "100000000", type: "direct",  tgeBps: 10000, cliffMonths: 0,  durationMonths: 0,  wallet: "" },
    { key: "VC",          label: "VC Sale",                    amount: "300000000", type: "vesting", tgeBps: 0,     cliffMonths: 18, durationMonths: 24, wallet: "" },
    { key: "TEAM",        label: "Team & Core",                amount: "300000000", type: "vesting", tgeBps: 0,     cliffMonths: 12, durationMonths: 36, wallet: "" },
    { key: "TREASURY",    label: "Treasury",                   amount: "400000000", type: "vesting", tgeBps: 0,     cliffMonths: 12, durationMonths: 24, wallet: "" },
    { key: "LIQUIDITY",   label: "Liquidity Pool",             amount: "160000000", type: "direct",  tgeBps: 10000, cliffMonths: 0,  durationMonths: 0,  wallet: "" },
    { key: "MARKETING",   label: "Marketing",                  amount: "100000000", type: "vesting", tgeBps: 0,     cliffMonths: 3,  durationMonths: 27, wallet: "" },
    { key: "ADVISORS",    label: "Advisors",                   amount: "40000000",  type: "vesting", tgeBps: 0,     cliffMonths: 12, durationMonths: 24, wallet: "" },
    { key: "PROTOCOLRES", label: "Protocol Reserve (retired)", amount: "100000000", type: "burn",    tgeBps: 0,     cliffMonths: 0,  durationMonths: 0,  wallet: "" },
    { key: "ECOSYSTEM",   label: "Ecosystem Reserve",          amount: "300000000", type: "vesting", tgeBps: 0,     cliffMonths: 12, durationMonths: 24, wallet: "" },
  ],
};
