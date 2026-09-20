# SL Token — opBNB 테스트넷 발행 프로젝트

심정지 예측 AI 스마트워치 프로젝트의 토큰 얼로케이션(최신 백서 기준)을 그대로 적용해
**발행 + 분배 + 베스팅**을 opBNB 테스트넷에 배포하기 위한 Hardhat 프로젝트입니다.
모든 베스팅은 "클리프 + 선형(linear)" 방식입니다.

> ⚠️ 이 프로젝트는 **테스트넷 기술 검증용**입니다. 메인넷 발행·판매 전에는 스마트컨트랙트
> 보안 감사와, 의료 표현·증권성 등에 대한 법률 검토가 별도로 필요합니다.

---

## 1. 구성

```
contracts/
  SLToken.sol      # ERC-20 토큰 (총 20억, 18 decimals, 소각 가능)
  SLVesting.sol    # TGE 즉시해제 + 클리프 + 선형 베스팅 매니저
config/
  allocations.js   # 얼로케이션·베스팅 수치 (최신 백서 기준) — 지갑 주소는 여기서 수정
scripts/
  deploy.js        # 발행 → 소각/직접전송/베스팅 자동 분배 + 합계 검증
test/
  SLToken.test.js  # 총량·분배·소각·베스팅 해제 검증 (시간이동 포함)
hardhat.config.js  # opBNB 테스트넷(chainId 5611) 설정
.env.example       # 환경변수 예시
```

## 2. 얼로케이션 요약 (총 20억)

| 카테고리 | 비율 | 토큰 수 | TGE | 클리프 | 선형 | 방식 |
| --- | --- | --- | --- | --- | --- | --- |
| Network Access Credit Pool | 10% | 200,000,000 | 0% | 6개월 | — (6개월 후 전량) | vesting (6개월 락 후 관리 지갑, 수요 기반 방출) |
| Participant Program | 5% | 100,000,000 | 0 | 6개월 | 36개월 | vesting (활동 기반 · 이용자 지급은 월 1,000,000 이하 정책 상한, 지급분마다 6개월 락) |
| VC Sale | 14.75% | 295,000,000 | 0% | 18개월 | 24개월 | vesting |
| Presale (VC Sale & Presale 의 프리세일 몫) | 0.25% | 5,000,000 | 100% (즉시) | — | — | direct (0.07 USDT, 락업 없음) |
| Team & Core | 15% | 300,000,000 | 0% | 12개월 | 36개월 | vesting |
| Treasury | 20% | 400,000,000 | 0% | 6개월 | 60개월 | vesting (분기 최대 20,000,000 = 총공급 1%) |
| Liquidity Pool | 8% | 160,000,000 | 100% (즉시) | — | — | direct (DEX 유동성 · LP 24개월 락) |
| Marketing | 5% | 100,000,000 | 20% (20,000,000) | 0 | 24개월 | vesting |
| Advisors | 2% | 40,000,000 | 0% | 12개월 | 24개월 | vesting |
| Protocol Reserve (retired) | 5% | 100,000,000 | 발행 직후 영구 소각 | — | — | burn |
| Ecosystem Reserve | 15% | 300,000,000 | 0% | 12개월 | 36개월 | vesting (거버넌스 의결 건별 집행) |

* 1개월 = 30일로 계산합니다.
* 모든 vesting은 클리프 종료 후 선형(linear) 해제입니다. 계단식은 사용하지 않습니다.
* Protocol Reserve 100M은 발행 직후 소각되어 유효 총공급량은 19억이 됩니다.
* Network Access Credit Pool(WCS 전환)과 Participant Program은 지금은 관리 지갑에 배정만 하며,
  전환·활동 기반 분배 로직은 오프체인 또는 별도 컨트랙트로 처리합니다.
* Liquidity Pool은 TGE에 전량 전송 후, DEX 유동성 공급으로 받는 LP 토큰을 24개월 락합니다(타임락 예약 전송).
* 상장일 즉시 해제 합계 = LP 160M + Marketing 20M + Presale 5M = 185,000,000 (9.25%), 매도가능 25,000,000 (1.25%). Participant Program 은 TGE 물량 없이 6개월 락(2026-09-15 회의, 09-20 반영). (2026-09-10 회의 확정, 09-12 반영 — 이 표와 config/allocations.js 가 단일 진실, 백서 v2.2 로 공시 예정)
* Treasury / Ecosystem Reserve는 1년 락 후 선형 해제이며, 실제 사용은 재단 governance vote로 결정·공지합니다.

## 3. 설치

전제: Node.js 18+ 설치.

```bash
npm install
```

## 4. 로컬 테스트 (배포 전 검증)

```bash
npx hardhat test
```

총 발행량, 얼로케이션 합계, 소각, 베스팅 해제(클리프·선형·시간이동)가 모두 검증됩니다.

## 5. 배포 전 설정

### (1) 지갑 주소 입력
`config/allocations.js`에서 각 버킷의 `wallet` 값을 실제 지갑 주소로 교체하세요.
비워두면(`""`) 모두 배포자 주소로 들어갑니다(빠른 테스트용).

### (2) 환경변수
```bash
cp .env.example .env
```
`.env`를 열어 **테스트넷 전용 지갑**의 `PRIVATE_KEY`를 입력하세요.
🚫 실제 자산이 있는 지갑 키, 또는 이 키를 타인(저 포함)과 공유하지 마세요.

### (3) 테스트넷 가스(tBNB) 받기
opBNB는 가스로 tBNB를 씁니다.
1. BNB Chain 공식 faucet에서 tBNB 받기: https://www.bnbchain.org/en/testnet-faucet
2. 받은 tBNB를 opBNB 테스트넷으로 브릿지 (opBNB 테스트넷 브릿지 사용).

## 6. opBNB 테스트넷 배포

```bash
npx hardhat run scripts/deploy.js --network opbnbTestnet
```

출력되는 `SLToken` / `SLVesting` 주소를 기록하세요.
익스플로러: https://opbnb-testnet.bscscan.com/

### 배포 환경변수 (선택)

- `TGE_TIMESTAMP` — 베스팅 시작(=상장) 시각을 unix 초로 지정. 미지정 시 "배포 시각 + 1시간"이 기본.
  베스팅 컨트랙트가 `start >= now` 를 강제하므로 **과거 값은 거부**됨. 메인넷은 실제 상장 예정 시각을 지정할 것.
- `VESTING_OWNER` — 배포·분배 후 `SLVesting` 소유권을 이전할 주소(= 48시간 타임락 멀티시그).
  지정 시 배포 마지막에 자동으로 `transferOwnership` 수행. 미지정 시 소유권은 배포자에게 유지.

```bash
TGE_TIMESTAMP=1793577600 VESTING_OWNER=0xTimelockMultisig \
  npx hardhat run scripts/deploy.js --network opbnbTestnet
```

## 7. (선택) 컨트랙트 검증

NodeReal 포털에서 API 키를 발급받아 `.env`의 `NODEREAL_API_KEY`에 넣은 뒤:

```bash
npx hardhat verify --network opbnbTestnet <SLToken주소> <배포자주소>
npx hardhat verify --network opbnbTestnet <SLVesting주소> <SLToken주소> <배포자주소>
```

## 8. 베스팅 청구 방법

각 수혜자는 `SLVesting`의 `release(id)`를 호출해 청구합니다.
`id`는 버킷 key의 keccak256입니다 (예: TEAM → `ethers.id("TEAM")`).
`releasable(id)`로 청구 가능량을 미리 조회할 수 있습니다.

## 9. 배포 검증 (읽기 전용, 프라이빗키 불필요)

배포가 의도대로 됐는지 확인하는 스크립트입니다. 프라이빗키 없이 조회만 합니다.

```bash
npx hardhat run scripts/verify.js --network opbnbTestnet
```

출력 내용:
- 총공급량 / 소각량(Protocol Reserve 1억) / 베스팅 컨트랙트 보유량
- 각 베스팅 버킷의 "지금" 청구 가능량
- TGE·3·6·12·13·24·48·60개월 시점의 해제 비율(%) 표
  (예: Team은 12개월까지 0%, 13개월부터 상승, 48개월에 100%)

배포 주소는 `deployments/<network>.json`을 자동으로 읽습니다.
다른 주소를 검증하려면 환경변수 `TOKEN_ADDR`, `VESTING_ADDR`로 지정하세요.

---

## 10. 1차 감사(QuillAudits) 대응 내역

컨트랙트 코드에 아래 수정을 반영했습니다.

| # | 심각도 | 반영 내용 |
| --- | --- | --- |
| 1 | High | `updateBeneficiary` — 수혜자 변경 전 기존 수혜자에게 미청구분 자동 정산. + 소유권을 48h 타임락 멀티시그로 이전(아래) |
| 2 | High | `createSchedule` — `start`를 `[now, now+365일]`로 온체인 검증 |
| 3 | Medium | `createSchedule` — 잔고 대비 지급여력 검증 + `totalCommitted` 추적 |
| 4 | Medium | `release` — 청구액과 잔고 중 작은 값 지급(부족 시 동결 없이 이월) |
| 5 | Medium | `createSchedule` — cliff/duration 상한 검증 + `amendSchedule`(시작 전 정정) 추가 |
| 6 | Low | `sweep(IERC20,address)` — SL은 잉여분만(잔고−totalCommitted), 외부 토큰은 전액 회수 |
| 7 | Info | `TOTAL_SUPPLY` → `INITIAL_SUPPLY` 이름 변경, 유통량은 `totalSupply()`로 조회 |
| 8 | Info | `SLToken`에서 Ownable 제거(오너 전용 기능 없음) |
| + | 추가 | 수혜자 검증 강화 — `address(0)`/컨트랙트 자신/토큰 주소를 beneficiary로 지정 금지(생성·변경 시) |

### 소유권 이전 — 48시간 타임락 멀티시그 (High 1)

메인넷에서는 배포·분배 직후 `SLVesting` 소유권을 **48시간 타임락이 걸린 멀티시그**로 이전합니다.

1. 멀티시그 생성 (opBNB Safe: https://multisig.bnbchain.org) — 서명자·정족수 지정
2. OpenZeppelin `TimelockController` 배포 — `minDelay = 172800`(48시간, 초), proposer=멀티시그, executor=멀티시그
3. 배포 시 `VESTING_OWNER`에 타임락 주소를 지정 → 자동 `transferOwnership`
   (또는 배포 후 수동으로 `vesting.transferOwnership(타임락주소)`)

이후 `updateBeneficiary`·`amendSchedule`·`sweep` 등 오너 권한은 "멀티시그 승인 + 48시간 지연"을 거쳐야만 실행됩니다.

> `SLToken`은 Ownable을 제거했으므로 소유권 이전 대상이 아닙니다(발행 후 통제 권한 없음).

---

## 네트워크 정보 (opBNB 테스트넷)

| 항목 | 값 |
| --- | --- |
| Network | opBNB Testnet |
| RPC | https://opbnb-testnet-rpc.bnbchain.org |
| Chain ID | 5611 |
| Gas Token | tBNB |
| Explorer | https://opbnb-testnet.bscscan.com |
