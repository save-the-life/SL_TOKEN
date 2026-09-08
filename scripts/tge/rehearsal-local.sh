#!/usr/bin/env bash
# 로컬 노드에서 TGE 전 과정을 한 번에 리허설한다 (Git Bash / WSL / macOS).
#   bash scripts/tge/rehearsal-local.sh
# 포크로 돌리려면:  FORK_URL=<BSC archive rpc> bash scripts/tge/rehearsal-local.sh   (DEX=bsc 로 실제 PancakeSwap 사용)
#
# 순서: DEX 사본(또는 포크) → 타임락 → preflight → 배포(중간 강제 중단 → 재개) → 불변식 → 부정 테스트
#      → 선점 시나리오(중단 확인) → 정렬 후 유동성 → LP 락 → 트레이딩 → 타임락 예약 → 모니터 20초 → 시간 이동 → 불변식
set -uo pipefail
cd "$(dirname "$0")/../.."
NET=localhost
mkdir -p deployments
rm -f deployments/$NET.json deployments/$NET.progress.json deployments/$NET.dex.json \
      deployments/$NET.timelock.json deployments/$NET.timelock-ops.json deployments/$NET.monitor.log

# 8545 포트를 점유한 프로세스를 전부 종료한다 (Windows 는 npx 래퍼를 죽여도 node 자식이 남는다).
kill_port() {
  if command -v netstat >/dev/null 2>&1; then
    for pid in $(netstat -ano 2>/dev/null | grep -E '[:.]8545 .*LISTEN' | awk '{print $NF}' | sort -u); do
      [ "$pid" = "0" ] && continue
      taskkill //PID "$pid" //T //F >/dev/null 2>&1 || kill -9 "$pid" 2>/dev/null || true
    done
  fi
  if command -v lsof >/dev/null 2>&1; then
    for pid in $(lsof -ti tcp:8545 2>/dev/null); do kill -9 "$pid" 2>/dev/null || true; done
  fi
}
if curl -s -X POST -H 'content-type: application/json' \
     --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' http://127.0.0.1:8545 >/dev/null 2>&1; then
  echo "⚠️  8545 에 이전 노드가 떠 있음 → 종료 후 새로 시작 (시간 이동된 상태를 재사용하지 않기 위해)"
  kill_port
  sleep 2
fi

if [ -n "${FORK_URL:-}" ]; then
  echo "▶ hardhat node --fork $FORK_URL"
  npx hardhat node --fork "$FORK_URL" ${FORK_BLOCK:+--fork-block-number $FORK_BLOCK} > deployments/$NET.node.log 2>&1 &
else
  echo "▶ hardhat node (로컬)"
  npx hardhat node > deployments/$NET.node.log 2>&1 &
fi
NODE_PID=$!
cleanup() { kill $NODE_PID 2>/dev/null || true; taskkill //PID $NODE_PID //T //F >/dev/null 2>&1 || true; kill_port; }
trap cleanup EXIT

for i in $(seq 1 90); do
  if curl -s -X POST -H 'content-type: application/json' \
       --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' http://127.0.0.1:8545 >/dev/null 2>&1; then break; fi
  sleep 1
done
echo "노드 준비 완료 (pid $NODE_PID)"

FAILED=0
run() { echo; echo "▶ $*"; "$@" || { echo "❌ 실패: $*"; FAILED=1; }; }
expect_exit() { local want=$1; shift; echo; echo "▶ $* (기대 exit=$want)"; "$@"; local got=$?; if [ "$got" = "$want" ]; then echo "✅ exit=$got"; else echo "❌ exit=$got (기대 $want)"; FAILED=1; fi; }

if [ -n "${FORK_URL:-}" ]; then
  export DEX=${DEX:-bsc}
  run npx hardhat run scripts/tge/fund-from-whale.js --network $NET
else
  run npx hardhat run scripts/tge/deploy-local-dex.js --network $NET
fi

run npx hardhat run scripts/deploy-timelock.js --network $NET
export VESTING_OWNER=$(node -p "require('./deployments/$NET.timelock.json').timelock")
echo "VESTING_OWNER=$VESTING_OWNER"

run npx hardhat run scripts/preflight.js --network $NET
expect_exit 2 env FAIL_AFTER_STEP=5 npx hardhat run scripts/deploy-resumable.js --network $NET
run npx hardhat run scripts/deploy-resumable.js --network $NET
run npx hardhat run scripts/tge/invariants.js --network $NET
run npx hardhat run scripts/tge/negative-tests.js --network $NET

run npx hardhat run scripts/tge/hostile-precreate.js --network $NET
expect_exit 3 npx hardhat run scripts/tge/add-liquidity-v2.js --network $NET
run env ALIGN=1 npx hardhat run scripts/tge/add-liquidity-v2.js --network $NET
run npx hardhat run scripts/tge/lock-lp.js --network $NET
run npx hardhat run scripts/tge/trade-sim.js --network $NET
run env ACTION=schedule BUCKET=ADVISORS NEW_BENEFICIARY=0x000000000000000000000000000000000000dEaD \
    npx hardhat run scripts/tge/timelock-ops.js --network $NET
run env ACTION=status npx hardhat run scripts/tge/timelock-ops.js --network $NET
run env RUN_SECONDS=20 INTERVAL_MS=5000 npx hardhat run scripts/tge/monitor.js --network $NET
run npx hardhat run scripts/tge/timetravel-check.js --network $NET
run env BUCKET=TREASURY npx hardhat run scripts/tge/release.js --network $NET
run npx hardhat run scripts/tge/invariants.js --network $NET

echo
if [ "$FAILED" = "0" ]; then echo "✅ LOCAL REHEARSAL COMPLETE"; else echo "❌ LOCAL REHEARSAL HAD FAILURES"; exit 1; fi
