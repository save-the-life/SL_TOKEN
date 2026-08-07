// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * VERIFICATION HARNESS ONLY -- never deployed, never part of the audited scope.
 *
 * Why this exists (run 16):
 * rule_sweep_foreign_exactness and rule_sweep_foreign_accounting_isolated both open with
 *     require t != token();          // the :227 foreign branch
 * but the only ERC20 implementation in `files` was SLToken, and the methods block dispatches every
 * unresolved callee into it. So `t` had to BE SLToken while simultaneously being != SLToken: no
 * execution path satisfied the preconditions and both rules came back VACUOUS -- reported green on
 * the dashboard while proving precisely nothing. That is strictly worse than a red, because it
 * silently inflates the pass count.
 *
 * A second, distinct ERC20 makes `t != token()` satisfiable, so the foreign branch of sweep
 * (SLVesting.sol:227) is exercised for real.
 *https://prover.certora.com/output/1125024/76b36240cf1b49d19b0edf7562bb8124?anonymousKey=4fa1c448553571bd91312ea3fb613ffd782948dc
 * Scope note: this is a WELL-BEHAVED ERC20. It does NOT close the LS-2 declared coverage gap for a
 * HOSTILE t (reverting / lying balanceOf / reentrant / codeless) -- P-107, P-117 and P-120 remain
 * DEFERRED and must still never be reported as verified over arbitrary t.
 */
contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MOCK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
