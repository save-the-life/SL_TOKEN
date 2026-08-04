// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/**
 * @title SL Token
 * @notice 심정지 예측 AI 스마트워치 프로젝트 토큰 (테스트넷용)
 *
 * - 초기 발행량: 20억 개 (2,000,000,000), 18 decimals
 * - 전량을 initialHolder에게 민팅 → 배포 스크립트가 각 얼로케이션 지갑/베스팅 컨트랙트로 분배
 * - ERC20Burnable: Protocol Reserve 등 영구 소각에 사용 (실제 공급량은 감소 가능)
 *
 * [1차 감사(QuillAudits) 대응]
 *  - (Info 7) TOTAL_SUPPLY → INITIAL_SUPPLY 로 이름 변경.
 *    소각으로 실제 공급이 줄어들므로, 이 상수는 "초기 발행량"만을 뜻함.
 *    유통/총공급량은 항상 totalSupply()로 조회할 것 (상수를 분모로 쓰지 말 것).
 *  - (Info 8) Ownable 제거. 이 토큰에는 owner 전용 기능이 전혀 없어 소유권 개념이 불필요하며,
 *    스캐너가 owner를 mint/pause 권한으로 오해하는 것을 방지.
 *
 * ※ 테스트넷 검증용. 메인넷 발행 전 보안 재감사 및 법률 검토 필요.
 */
contract SLToken is ERC20, ERC20Burnable {
    // 초기 발행량: 20억 × 10^18 (소각으로 실제 공급은 이보다 작아질 수 있음)
    uint256 public constant INITIAL_SUPPLY = 2_000_000_000 * 1e18;

    constructor(address initialHolder) ERC20("SL Token", "SL") {
        require(initialHolder != address(0), "holder=0");
        _mint(initialHolder, INITIAL_SUPPLY);
    }
}
