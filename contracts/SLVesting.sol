// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SL Vesting
 * @notice TGE 즉시해제(%) + 클리프 + 선형 베스팅 매니저
 *
 * 해제 공식 (시각 t, start = TGE 시점):
 *   tgeAmount  = total * tgeBps / 10000            // TGE 즉시 해제분
 *   remaining  = total - tgeAmount
 *   t < start + cliff                  → 선형분 0
 *   t >= start + cliff + duration      → 선형분 = remaining (전량)
 *   그 사이                            → 선형분 = remaining * (t-(start+cliff)) / duration
 *   vested = tgeAmount + 선형분,  releasable = vested - released
 *
 * 각 카테고리(VC, Team, Treasury 등)를 하나의 schedule로 생성. 수혜자가 release()로 청구.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * [1차 감사(QuillAudits) 대응 — 반영 내역]
 *  - High 1  updateBeneficiary: 수혜자 변경 전 기존 수혜자에게 미청구 누적분을 먼저 정산.
 *            (추가로 소유권은 배포 직후 48시간 타임락 멀티시그로 이전 — 운영 절차, deploy 참고)
 *  - High 2  createSchedule: start 를 [now, now + MAX_START_DELAY] 로 온체인 검증.
 *  - Med 3   createSchedule: 컨트랙트 잔고 대비 지급여력(solvency) 검증 + 커밋 총액(totalCommitted) 추적.
 *  - Med 4   release: "청구액과 잔고 중 작은 값"을 지급해 부족분 발생 시에도 동결 없이 진행.
 *  - Med 5   createSchedule: cliff/duration 상한 검증 + 시작 전 스케줄 수정(amendSchedule) 허용.
 *  - Low 6   sweep: 토큰 인자로 일반화. SL은 잉여분만(잔고-totalCommitted), 외부 토큰은 전액 회수.
 *            (surplus 계산은 확정본 그대로 — totalReleased 미도입)
 *  - 추가    수혜자 검증 강화: address(0)/this/token 을 beneficiary로 지정 금지(생성·변경 시).
 * ─────────────────────────────────────────────────────────────────────────
 */
contract SLVesting is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

    // (High 2 / Med 5) 입력값 상한
    uint64 public constant MAX_START_DELAY = 365 days;
    uint64 public constant MAX_CLIFF = 3650 days;    // ~10년
    uint64 public constant MAX_DURATION = 3650 days; // ~10년

    struct Schedule {
        address beneficiary;   // 수혜 지갑
        uint256 total;         // 이 스케줄의 총 배정량
        uint256 released;      // 이미 청구된 양
        uint64  start;         // TGE(베스팅 시작) 시각 (unix seconds)
        uint64  cliff;         // 클리프 길이 (초)
        uint64  duration;      // 클리프 이후 선형 해제 길이 (초)
        uint16  tgeBps;        // TGE 즉시 해제 비율 (basis points, 10000 = 100%)
        bool    exists;
    }

    mapping(bytes32 => Schedule) public schedules;
    bytes32[] public scheduleIds;

    // (Med 3) 아직 지급되지 않은 스케줄 총 약정량. 항상 컨트랙트 잔고 <= 이하가 아니라,
    //         "잔고 >= totalCommitted" 불변식을 유지한다(createSchedule에서 검증, release/sweep에서 보존).
    uint256 public totalCommitted;

    event ScheduleCreated(bytes32 indexed id, address indexed beneficiary, uint256 total);
    event ScheduleAmended(bytes32 indexed id);
    event Released(bytes32 indexed id, address indexed beneficiary, uint256 amount);
    event BeneficiaryUpdated(bytes32 indexed id, address oldBeneficiary, address newBeneficiary);
    event Swept(address indexed token, address indexed to, uint256 amount);

    constructor(address token_, address owner_) Ownable(owner_) {
        require(token_ != address(0), "token=0");
        token = IERC20(token_);
    }

    /**
     * @notice 스케줄 생성. 토큰은 이 컨트랙트로 미리 전송되어 있어야 함(배포 스크립트가 처리).
     */
    function createSchedule(
        bytes32 id,
        address beneficiary,
        uint256 total,
        uint64 start,
        uint64 cliffSeconds,
        uint64 durationSeconds,
        uint16 tgeBps
    ) external onlyOwner {
        require(!schedules[id].exists, "exists");
        // (감사 추가) 시스템 주소를 수혜자로 지정 금지: 0 / 컨트랙트 자신 / 토큰 컨트랙트
        require(
            beneficiary != address(0) && beneficiary != address(this) && beneficiary != address(token),
            "bad beneficiary"
        );
        require(total > 0, "total=0");
        require(tgeBps <= 10000, "tgeBps>100%");
        // (High 2) start 범위 검증 — 과거값(즉시해제)·비현실적 미래값(영구잠김) 차단
        require(start >= uint64(block.timestamp), "start in past");
        require(start <= uint64(block.timestamp) + MAX_START_DELAY, "start too far");
        // (Med 5) cliff/duration 상한 검증
        require(cliffSeconds <= MAX_CLIFF, "cliff too long");
        require(durationSeconds <= MAX_DURATION, "duration too long");
        // (Med 3) 지급여력 검증 — 기존 커밋분 + 이번 배정량만큼 잔고가 있어야 함
        require(token.balanceOf(address(this)) >= totalCommitted + total, "underfunded");

        schedules[id] = Schedule({
            beneficiary: beneficiary,
            total: total,
            released: 0,
            start: start,
            cliff: cliffSeconds,
            duration: durationSeconds,
            tgeBps: tgeBps,
            exists: true
        });
        scheduleIds.push(id);
        totalCommitted += total;
        emit ScheduleCreated(id, beneficiary, total);
    }

    /**
     * @notice (Med 5) 아직 시작되지 않은(start 이전) 스케줄의 시간·비율 파라미터 정정.
     *         total(금액)은 변경 불가 → 커밋 회계·지급여력에 영향 없음.
     */
    function amendSchedule(
        bytes32 id,
        uint64 start,
        uint64 cliffSeconds,
        uint64 durationSeconds,
        uint16 tgeBps
    ) external onlyOwner {
        Schedule storage s = schedules[id];
        require(s.exists, "no schedule");
        require(uint64(block.timestamp) < s.start, "already started");
        require(tgeBps <= 10000, "tgeBps>100%");
        require(start >= uint64(block.timestamp), "start in past");
        require(start <= uint64(block.timestamp) + MAX_START_DELAY, "start too far");
        require(cliffSeconds <= MAX_CLIFF, "cliff too long");
        require(durationSeconds <= MAX_DURATION, "duration too long");

        s.start = start;
        s.cliff = cliffSeconds;
        s.duration = durationSeconds;
        s.tgeBps = tgeBps;
        emit ScheduleAmended(id);
    }

    /// @notice 특정 시각 기준 누적 vested 양
    function vestedAmount(bytes32 id, uint64 timestamp) public view returns (uint256) {
        Schedule memory s = schedules[id];
        require(s.exists, "no schedule");
        if (timestamp < s.start) return 0;

        uint256 tgeAmount = (s.total * s.tgeBps) / 10000;
        uint256 remaining = s.total - tgeAmount;

        uint64 linearStart = s.start + s.cliff;
        uint256 linear;
        if (timestamp < linearStart) {
            linear = 0;
        } else if (s.duration == 0 || timestamp >= linearStart + s.duration) {
            linear = remaining;
        } else {
            linear = (remaining * (timestamp - linearStart)) / s.duration;
        }
        return tgeAmount + linear;
    }

    /// @notice 지금 청구 가능한 양(회계상; 실제 지급은 잔고 한도 내)
    function releasable(bytes32 id) public view returns (uint256) {
        return vestedAmount(id, uint64(block.timestamp)) - schedules[id].released;
    }

    /// @notice 수혜자(또는 누구나)가 호출 → 청구분을 수혜 지갑으로 전송
    function release(bytes32 id) external {
        require(schedules[id].exists, "no schedule");
        uint256 paid = _release(id);
        require(paid > 0, "nothing to release");
    }

    /**
     * @dev (Med 4) 청구 로직. 청구액과 컨트랙트 잔고 중 작은 값을 지급.
     *      부족분이 있어도 revert하지 않고 지급 가능한 만큼만 지급(나머지는 다음 청구로 이월).
     *      실제 지급액만큼만 released·totalCommitted를 갱신. 청구할 게 없으면 0 반환(무동작).
     */
    function _release(bytes32 id) internal returns (uint256 paid) {
        Schedule storage s = schedules[id];
        uint256 accrued = vestedAmount(id, uint64(block.timestamp)) - s.released;
        if (accrued == 0) return 0;
        uint256 bal = token.balanceOf(address(this));
        paid = accrued <= bal ? accrued : bal;
        if (paid == 0) return 0;
        s.released += paid;
        totalCommitted -= paid;
        token.safeTransfer(s.beneficiary, paid);
        emit Released(id, s.beneficiary, paid);
    }

    /**
     * @notice (High 1) 수혜 지갑 변경(분실 대응 등). 소유자만.
     *         변경 전에 기존 수혜자에게 미청구 누적분을 먼저 정산한다.
     *         이 권한은 배포 직후 48시간 타임락 멀티시그로 이전해 통제할 것.
     */
    function updateBeneficiary(bytes32 id, address newBeneficiary) external onlyOwner {
        // (감사 추가) 시스템 주소를 수혜자로 지정 금지
        require(
            newBeneficiary != address(0) && newBeneficiary != address(this) && newBeneficiary != address(token),
            "bad beneficiary"
        );
        Schedule storage s = schedules[id];
        require(s.exists, "no schedule");
        _release(id); // 기존 수혜자에게 정산 먼저(청구분이 없으면 무동작)
        emit BeneficiaryUpdated(id, s.beneficiary, newBeneficiary);
        s.beneficiary = newBeneficiary;
    }

    /**
     * @notice (Low 6) 잉여 토큰 회수. 오너만.
     *         - SL 토큰(this.token)   : 스케줄에 약정되지 않은 잉여분만 회수(커밋 물량은 보호).
     *           totalCommitted는 release 때마다 감소하므로 "잔고 - totalCommitted"가 곧 잉여이며,
     *           잔고 < 커밋(비정상) 상태에서는 언더플로로 revert하여 커밋 물량을 보호.
     *         - 그 외 ERC-20(오전송분): 전액 회수(베스팅 약정과 무관).
     * @dev QuillAudits Low #6 확정본. surplus 계산은 SL 브랜치에서 그대로 유지.
     */
    function sweep(IERC20 t, address to) external onlyOwner returns (uint256 amount) {
        require(to != address(0), "to=0");
        if (address(t) == address(token)) {
            amount = t.balanceOf(address(this)) - totalCommitted; // 잉여분만
        } else {
            amount = t.balanceOf(address(this)); // 오전송된 외부 토큰 전액
        }
        require(amount > 0, "nothing to sweep");
        t.safeTransfer(to, amount);
        emit Swept(address(t), to, amount);
    }

    function scheduleCount() external view returns (uint256) {
        return scheduleIds.length;
    }
}
