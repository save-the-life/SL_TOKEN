// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SL Vesting
 * @notice TGE 즉시해제(%) + 클리프 + 선형 베스팅을 지원하는 베스팅 매니저
 *
 * 해제 공식 (시각 t, start = TGE 시점):
 *   tgeAmount  = total * tgeBps / 10000           // TGE 시점 즉시 해제분
 *   remaining  = total - tgeAmount
 *   t < start + cliff                  → 선형분 0
 *   t >= start + cliff + duration      → 선형분 = remaining (전량)
 *   그 사이                            → 선형분 = remaining * (t - (start+cliff)) / duration
 *   vested     = tgeAmount + 선형분
 *   releasable = vested - released
 *
 * 각 카테고리(Seed, Team, Treasury 등)를 하나의 schedule로 생성합니다.
 * 베스팅 대상 토큰은 이 컨트랙트가 보유하며, 수혜자(beneficiary)가 release()로 청구합니다.
 */
contract SLVesting is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

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

    // scheduleId => Schedule
    mapping(bytes32 => Schedule) public schedules;
    bytes32[] public scheduleIds;

    event ScheduleCreated(bytes32 indexed id, address indexed beneficiary, uint256 total);
    event Released(bytes32 indexed id, address indexed beneficiary, uint256 amount);
    event BeneficiaryUpdated(bytes32 indexed id, address oldBeneficiary, address newBeneficiary);

    constructor(address token_, address owner_) Ownable(owner_) {
        require(token_ != address(0), "token=0");
        token = IERC20(token_);
    }

    /**
     * @notice 스케줄 생성. 토큰은 이 컨트랙트로 미리 전송되어 있어야 합니다(배포 스크립트가 처리).
     * @param id        고유 식별자 (예: keccak256("TEAM"))
     * @param beneficiary 수혜 지갑
     * @param total     총 배정량 (wei 단위, 18 decimals)
     * @param start     TGE 시각 (unix seconds)
     * @param cliffSeconds 클리프 (초)
     * @param durationSeconds 선형 해제 길이 (초)
     * @param tgeBps    TGE 즉시 해제 비율 (basis points)
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
        require(beneficiary != address(0), "beneficiary=0");
        require(total > 0, "total=0");
        require(tgeBps <= 10000, "tgeBps>100%");

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
        emit ScheduleCreated(id, beneficiary, total);
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

    /// @notice 지금 청구 가능한 양
    function releasable(bytes32 id) public view returns (uint256) {
        return vestedAmount(id, uint64(block.timestamp)) - schedules[id].released;
    }

    /// @notice 수혜자(또는 누구나)가 호출 → 청구분을 수혜 지갑으로 전송
    function release(bytes32 id) external {
        Schedule storage s = schedules[id];
        require(s.exists, "no schedule");
        uint256 amount = vestedAmount(id, uint64(block.timestamp)) - s.released;
        require(amount > 0, "nothing to release");
        s.released += amount;
        token.safeTransfer(s.beneficiary, amount);
        emit Released(id, s.beneficiary, amount);
    }

    /// @notice 수혜 지갑 변경(분실 대응 등). 소유자만.
    function updateBeneficiary(bytes32 id, address newBeneficiary) external onlyOwner {
        require(newBeneficiary != address(0), "beneficiary=0");
        Schedule storage s = schedules[id];
        require(s.exists, "no schedule");
        emit BeneficiaryUpdated(id, s.beneficiary, newBeneficiary);
        s.beneficiary = newBeneficiary;
    }

    function scheduleCount() external view returns (uint256) {
        return scheduleIds.length;
    }
}
