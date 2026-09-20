// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDT (리허설 전용)
 * @notice BSC 테스트넷에는 정식 USDT가 없다. BSC 실제 USDT와 같은 18 decimals 로 만들어
 *         DEX 리허설의 상대편 토큰으로 쓴다. 누구나 mint 가능 — 테스트넷 밖에서는 절대 쓰지 않는다.
 *         감사 범위 밖이며 메인넷 TGE 와 무관하다.
 */
contract MockUSDT is ERC20 {
    constructor() ERC20("Mock USDT (rehearsal)", "mUSDT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
