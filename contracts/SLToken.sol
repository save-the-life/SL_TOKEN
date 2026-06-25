// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SL Token
 * @notice 심정지 예측 AI 스마트워치 프로젝트 토큰 (테스트넷용)
 *
 * - 총 발행량: 20억 개 (2,000,000,000), 18 decimals
 * - 전량을 배포자(deployer)에게 민팅 → 배포 스크립트가 각 얼로케이션 지갑/베스팅 컨트랙트로 분배
 * - ERC20Burnable: Burn Reserve 등 영구 소각에 사용
 *
 * ※ 테스트넷 검증용 컨트랙트입니다. 메인넷 발행 전에는 보안 감사 및 법률 검토가 별도로 필요합니다.
 */
contract SLToken is ERC20, ERC20Burnable, Ownable {
    // 20억 × 10^18
    uint256 public constant TOTAL_SUPPLY = 2_000_000_000 * 1e18;

    constructor(address initialHolder)
        ERC20("SL Token", "SL")
        Ownable(initialHolder)
    {
        // 전량을 initialHolder(배포자)에게 발행. 분배는 배포 스크립트에서 처리.
        _mint(initialHolder, TOTAL_SUPPLY);
    }
}
