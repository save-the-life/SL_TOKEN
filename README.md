# SL Token — opBNB 테스트넷 발행 프로젝트

심정지 예측 AI 스마트워치 프로젝트의 토큰 얼로케이션(백서 v4.1)을 그대로 적용해
**발행 + 분배 + 베스팅**을 opBNB 테스트넷에 배포하기 위한 Hardhat 프로젝트입니다.

> ⚠️ 이 프로젝트는 **테스트넷 기술 검증용**입니다. 메인넷 발행·판매 전에는 스마트컨트랙트
> 보안 감사와, 의료 표현·증권성 등에 대한 법률 검토가 별도로 필요합니다.

---

## 1. 구성

```
contracts/
  SLToken.sol      # ERC-20 토큰 (총 20억, 18 decimals, 소각 가능)
  SLVesting.sol    # TGE 즉시해제 + 클리프 + 선형 베스팅 매니저
config/
  allocations.js   # 얼로케이션·베스팅 수치 (백서 v4.1) — 지갑 주소는 여기서 수정
scripts/
  deploy.js        # 발행 → 소각/직접전송/베스팅 자동 분배 + 합계 검증
test/
  SLToken.test.js  # 총량·분배·소각·베스팅 해제 검증 (시간이동 포함)
hardhat.config.js  # opBNB 테스트넷(chainId 5611) 설정
.env.example       # 환경변수 예시
```

## 2. 얼로케이션 요약 (총 20억)

| 카테고리 | 비율 | 토큰 수 | TGE | 클리프 | 선형 |
| --- | --- | --- | --- | --- | --- |
| Seed | 0.75% | 15,000,000 | 5% | 6개월 | 18개월 |
| 노드세일 즉시 1차 | — | 15,000,000 | 15% | 0 | 8개월 |
| 노드세일 즉시 2차 | — | 15,700,000 | 25% | 0 | 5개월 |
| Community Mining | 30% | 600,000,000 | 0% | 0 | 60개월 |
| Ambassador | 7% | 140,000,000 | 0% | 3개월 | 36개월 |
| Team & Core | 15% | 300,000,000 | 0% | 12개월 | 36개월 |
| Treasury | 18% | 360,000,000 | 3% | 6개월 | 24개월 |
| Liquidity Pool | 8% | 160,000,000 | 100% (즉시) | — | — |
| Marketing | 5% | 100,000,000 | 15% | 0 | 12개월 |
| Advisors | 2% | 40,000,000 | 0% | 12개월 | 24개월 |
| Burn Reserve | 3% | 60,000,000 | 발행 직후 영구 소각 | — | — |
| Post-Listing | 3% | 60,000,000 | 0% | 12개월 | 24개월 |
| 미배분 예비 | 6.71% | 134,300,000 | 즉시 보유 | — | — |

* 1개월 = 30일로 계산합니다.
* Burn Reserve 60M은 발행 직후 소각되어 유효 총공급량은 19.4억이 됩니다.

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
- 총공급량 / 소각량(Burn Reserve 6천만) / 베스팅 컨트랙트 보유량
- 각 베스팅 버킷의 "지금" 청구 가능량
- TGE·3·6·12·13·24·48·60개월 시점의 해제 비율(%) 표
  (예: Team은 12개월까지 0%, 13개월부터 상승, 48개월에 100%)

배포 주소는 `deployments/<network>.json`을 자동으로 읽습니다.
다른 주소를 검증하려면 환경변수 `TOKEN_ADDR`, `VESTING_ADDR`로 지정하세요.

---

## 네트워크 정보 (opBNB 테스트넷)

| 항목 | 값 |
| --- | --- |
| Network | opBNB Testnet |
| RPC | https://opbnb-testnet-rpc.bnbchain.org |
| Chain ID | 5611 |
| Gas Token | tBNB |
| Explorer | https://opbnb-testnet.bscscan.com |
