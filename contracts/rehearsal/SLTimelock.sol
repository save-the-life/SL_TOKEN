// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/governance/TimelockController.sol";

/**
 * @title SLTimelock
 * @notice OpenZeppelin TimelockController 를 그대로 쓴다(코드 추가 없음).
 *         SLVesting 의 owner 로 지정해 모든 오너 권한(스케줄 생성·수혜자 변경·sweep)이
 *         minDelay(48h) 뒤에만 실행되게 한다. LP 토큰 락(24개월 예약 전송)에도 같은 컨트랙트를 쓴다.
 *
 *         proposers / executors 에는 Safe 멀티시그 주소를 넣는다. admin 은 address(0) 로 두어
 *         타임락 자체가 자신의 관리자가 되게 한다(역할 변경도 48h 지연).
 */
contract SLTimelock is TimelockController {
    constructor(
        uint256 minDelay,
        address[] memory proposers,
        address[] memory executors,
        address admin
    ) TimelockController(minDelay, proposers, executors, admin) {}
}
