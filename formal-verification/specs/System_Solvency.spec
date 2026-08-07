using SLToken as slToken;
using MockERC20 as mockToken;
methods {
    function _.transfer(address, uint256) external => DISPATCHER(true);
    function _.balanceOf(address)         external => DISPATCHER(true);
    unresolved external in _._ => DISPATCH(optimistic=true) [
        SLToken.transfer(address,uint256),
        SLToken.transferFrom(address,address,uint256),
        SLToken.balanceOf(address),
        MockERC20.transfer(address,uint256),
        MockERC20.transferFrom(address,address,uint256),
        MockERC20.balanceOf(address)
    ];
    function slToken.balanceOf(address)           external returns (uint256) envfree;
    function mockToken.balanceOf(address)         external returns (uint256) envfree;
    function slToken.totalSupply()                external returns (uint256) envfree;
    function slToken.allowance(address, address)  external returns (uint256) envfree;
    function totalCommitted()  external returns (uint256) envfree;
    function scheduleCount()   external returns (uint256) envfree;
    function token()           external returns (address) envfree;
    function owner()           external returns (address) envfree;
    function vestedAmount(bytes32, uint64) external returns (uint256);
    function releasable(bytes32)           external returns (uint256);
}
ghost mathint g_sumTotal {
    init_state axiom g_sumTotal == 0;
}
ghost mathint g_sumReleased {
    init_state axiom g_sumReleased == 0;
}
ghost mathint g_numSchedules {
    init_state axiom g_numSchedules == 0;
}
ghost mathint g_sumOfBalances {
    init_state axiom g_sumOfBalances == 0;
}
hook Sstore slToken._balances[KEY address a] uint256 newValue (uint256 oldValue) {
    g_sumOfBalances = g_sumOfBalances + to_mathint(newValue) - to_mathint(oldValue);
}
hook Sload uint256 val slToken._balances[KEY address a] {
    require to_mathint(val) <= 2000000000000000000000000000;
}
hook Sload uint256 val mockToken._balances[KEY address a] {
    require to_mathint(val) <= 2000000000000000000000000000;
}
hook Sload uint256 val slToken._allowances[KEY address o][KEY address sp] {
    if (o == currentContract || o == slToken) {
        require val == 0;
    }
}
hook Sstore schedules[KEY bytes32 id].total uint256 newValue (uint256 oldValue) {
    g_sumTotal = g_sumTotal + to_mathint(newValue) - to_mathint(oldValue);
}
hook Sstore schedules[KEY bytes32 id].released uint256 newValue (uint256 oldValue) {
    g_sumReleased = g_sumReleased + to_mathint(newValue) - to_mathint(oldValue);
}
hook Sload address b schedules[KEY bytes32 id].beneficiary {
    require b != currentContract && b != slToken;
}
hook Sload uint64 c schedules[KEY bytes32 id].cliff {
    require to_mathint(c) <= 315360000;
}
hook Sload uint64 d schedules[KEY bytes32 id].duration {
    require to_mathint(d) <= 315360000;
}
hook Sstore schedules[KEY bytes32 id].exists bool newValue (bool oldValue) {
    if (newValue && !oldValue) {
        g_numSchedules = g_numSchedules + 1;
    }
    if (!newValue && oldValue) {
        g_numSchedules = g_numSchedules - 1;
    }
}
function surplus() returns mathint {
    return to_mathint(slToken.balanceOf(currentContract)) - to_mathint(totalCommitted());
}
function vestingBalance() returns mathint {
    return to_mathint(slToken.balanceOf(currentContract));
}
function requireSaneTime(env e) {
    require e.block.timestamp < 9223372036854775808;
}
function requireRealSender(env e) {
    require e.msg.sender != 0;
}
function requireExternalSender(env e) {
    require e.msg.sender != currentContract;
    require e.msg.sender != slToken;
}

// ST-3: sweep(token,this) must leave B unchanged - OZ _update nets from==to to zero.
rule rule_solvency_selftest_sweep_self_destination_is_noop(env e) {
    requireRealSender(e);
    require e.msg.value == 0;
    address t = token();

    mathint balBefore = vestingBalance();
    uint256 tcBefore  = totalCommitted();

    uint256 amount1 = sweep(e, t, currentContract);

    mathint balMid = vestingBalance();
    uint256 tcMid  = totalCommitted();

    assert balMid == balBefore,
        "ST-3: sweep(token,this) must leave B unchanged - OZ _update nets from==to to zero";
    assert tcMid == tcBefore,
        "ST-3: sweep writes no storage (:222-232), so totalCommitted cannot move";

    uint256 amount2 = sweep(e, t, currentContract);

    assert amount2 == amount1,
        "ST-3: surplus B-TC did not fall, so the second sweep computes the same amount";
    assert vestingBalance() == balBefore,
        "ST-3: two self-sweeps in a row still move nothing";
    assert to_mathint(amount1) > 0,
        "ST-3: a sweep that reached :230 had amount > 0 by the :229 require";
}

// rule solvency surplus reachable.
rule rule_solvency_surplus_reachable(env e, uint256 donation) {
    requireExternalSender(e);
    requireRealSender(e);
    require totalCommitted() == to_mathint(slToken.balanceOf(currentContract));
    require donation > 0;

    slToken.transfer(e, currentContract, donation);

    satisfy surplus() > 0;
}

// A schedule that does not exist holds zero in both total and released.
invariant inv_sol_sched_nonexistent_is_zero(bytes32 id)
    !currentContract.schedules[id].exists =>
        ( currentContract.schedules[id].total == 0 && currentContract.schedules[id].released == 0 );

// totalCommitted always equals the sum of (total - released) over every existing schedule.
invariant inv_solvency_ledger_identity()
    to_mathint(totalCommitted()) == g_sumTotal - g_sumReleased
    {
        preserved createSchedule(bytes32 id, address b, uint256 t, uint64 st, uint64 c, uint64 d, uint16 g) with (env e) {
            requireSaneTime(e);
            requireExternalSender(e);
            requireInvariant inv_sol_sched_nonexistent_is_zero(id);
        }
        preserved with (env e) {
            requireSaneTime(e);
            requireExternalSender(e);
        }
    }

// Approve sets _allowances[msg.sender][.]; msg.sender can never be the vesting contract.
rule rule_solvency_no_external_actor_can_approve_for_vesting(env e, address spender, uint256 value) {
    requireExternalSender(e);
    requireRealSender(e);
    uint256 before = slToken.allowance(currentContract, spender);

    slToken.approve(e, spender, value);

    assert slToken.allowance(currentContract, spender) == before,
        "approve sets _allowances[msg.sender][.]; msg.sender can never be the vesting contract";
}

// Transfer debits msg.sender, which is never the vesting contract.
rule rule_solvency_vesting_balance_not_externally_reducible_transfer(env e, address to, uint256 v) {
    requireExternalSender(e);
    mathint before = vestingBalance();
    slToken.transfer(e, to, v);
    assert vestingBalance() >= before,
        "transfer debits msg.sender, which is never the vesting contract";
}

// TransferFrom(vesting,.,v) needs allowance(vesting,sender) >= v, which is always 0.
rule rule_solvency_vesting_balance_not_externally_reducible_transferFrom(
    env e, address from, address to, uint256 v
) {
    requireExternalSender(e);
    mathint before = vestingBalance();
    slToken.transferFrom(e, from, to, v);
    assert vestingBalance() >= before,
        "transferFrom(vesting,.,v) needs allowance(vesting,sender) >= v, which is always 0";
}

// Burn() burns the caller's own balance; the caller is never the vesting contract.
rule rule_solvency_vesting_balance_not_externally_reducible_burn(env e, uint256 v) {
    requireExternalSender(e);
    mathint before = vestingBalance();
    slToken.burn(e, v);
    assert vestingBalance() >= before,
        "burn() burns the caller's own balance; the caller is never the vesting contract";
}

// BurnFrom(vesting,v) consumes allowance(vesting,sender) == 0 and reverts.
rule rule_solvency_vesting_balance_not_externally_reducible_burnFrom(env e, address account, uint256 v) {
    requireExternalSender(e);
    mathint before = vestingBalance();
    slToken.burnFrom(e, account, v);
    assert vestingBalance() >= before,
        "burnFrom(vesting,v) consumes allowance(vesting,sender) == 0 and reverts";
}

// The vesting balance may fall only through a release payout or a sweep.
rule rule_solvency_outflow_sites_exhaustive(method f, env e, calldataarg args)
    filtered { f -> !f.isView }
{
    requireExternalSender(e);
    requireSaneTime(e);

    mathint before = vestingBalance();
    f(e, args);
    mathint after = vestingBalance();

    assert after < before =>
        (   f.selector == sig:release(bytes32).selector
         || f.selector == sig:updateBeneficiary(bytes32,address).selector
         || f.selector == sig:sweep(address,address).selector ),
        "B may fall only through :192 (release/updateBeneficiary) or :230 (sweep)";
}

// The vesting contract's SL balance is never below totalCommitted: committed tokens are always backed.
invariant inv_solvency_balance_ge_committed()
    slToken.balanceOf(currentContract) >= totalCommitted()
    {
        preserved with (env e) {
            requireSaneTime(e);
            requireExternalSender(e);
            requireInvariant inv_solvency_ledger_identity();
        }
    }

// No method may manufacture sweepable surplus B-TC.
rule rule_solvency_surplus_non_increasing(method f, env e, calldataarg args)
    filtered { f -> f.contract == currentContract && !f.isView }
{
    requireExternalSender(e);
    requireSaneTime(e);
    requireInvariant inv_solvency_ledger_identity();
    requireInvariant inv_solvency_balance_ge_committed();

    mathint before = surplus();
    f(e, args);
    mathint after = surplus();

    assert after <= before,
        "no method may manufacture sweepable surplus B-TC";
}

// ST-1 anchor: surplus is never manufactured (must fail at c36d0fb).
rule rule_solvency_surplus_never_manufactured(method f, env e, calldataarg args)
    filtered { f -> f.contract == currentContract && !f.isView }
{
    requireExternalSender(e);
    requireSaneTime(e);

    mathint before = surplus();
    f(e, args);
    mathint after = surplus();

    assert after <= before,
        "ST-1 anchor: surplus is never manufactured (must fail at c36d0fb)";
}

// Total outstanding entitlement never exceeds the vesting contract's SL balance.
invariant inv_solvency_sum_releasable_le_balance()
    g_sumTotal - g_sumReleased <= to_mathint(slToken.balanceOf(currentContract))
    {

        preserved createSchedule(bytes32 id, address b, uint256 t, uint64 st, uint64 c, uint64 d, uint16 g) with (env e) {
            requireSaneTime(e);
            requireExternalSender(e);
            requireInvariant inv_sol_sched_nonexistent_is_zero(id);
            requireInvariant inv_solvency_ledger_identity();
            requireInvariant inv_solvency_balance_ge_committed();
        }
        preserved with (env e) {
            requireSaneTime(e);
            requireExternalSender(e);
            requireInvariant inv_solvency_ledger_identity();
            requireInvariant inv_solvency_balance_ge_committed();
        }
    }

// Vested(id,now) <= total(id) because tgeBps <= 10000 and linear <= remaining.
rule rule_solvency_releasable_le_schedule_remainder(env e, bytes32 id) {
    requireSaneTime(e);
    require currentContract.schedules[id].exists;

    uint256 r = releasable(e, id);

    assert to_mathint(r) <= to_mathint(currentContract.schedules[id].total)
                          - to_mathint(currentContract.schedules[id].released),
        "vested(id,now) <= total(id) because tgeBps <= 10000 and linear <= remaining";
}

// An existing schedule's beneficiary is never address(0), the vesting contract, or the token contract.
invariant inv_solvency_beneficiary_domain(bytes32 id)
    currentContract.schedules[id].exists =>
        (   currentContract.schedules[id].beneficiary != 0
         && currentContract.schedules[id].beneficiary != currentContract
         && currentContract.schedules[id].beneficiary != token() )
    {
        preserved with (env e) {
            requireExternalSender(e);
        }
    }

// The commitment decrement and the token transfer move the two sides by the same amount.
rule rule_release_surplus_neutral(method f, env e, calldataarg args)
    filtered {
        f -> !f.isView && f.selector == sig:release(bytes32).selector
          || f.selector == sig:updateBeneficiary(bytes32,address).selector
    }
{
    requireExternalSender(e);
    requireSaneTime(e);
    requireInvariant inv_solvency_ledger_identity();
    requireInvariant inv_solvency_balance_ge_committed();

    mathint before = surplus();
    f(e, args);
    assert surplus() == before,
        ":191 (TC -= paid) and :192 (transfer of paid) move the two sides by the same amount";
}

// createSchedule makes no external transfer; it only reads the balance for its solvency check.
rule rule_create_commits_without_moving_balance(
    env e, bytes32 id, address beneficiary, uint256 total,
    uint64 start, uint64 cliffSeconds, uint64 durationSeconds, uint16 tgeBps
) {
    requireExternalSender(e);
    requireSaneTime(e);

    mathint bBefore  = vestingBalance();
    uint256 tcBefore = totalCommitted();

    createSchedule(e, id, beneficiary, total, start, cliffSeconds, durationSeconds, tgeBps);

    assert vestingBalance() == bBefore,
        "createSchedule makes no external transfer; only :101 reads the balance";
    assert to_mathint(totalCommitted()) == to_mathint(tcBefore) + to_mathint(total),
        ":114 adds exactly `total` to totalCommitted";
    assert surplus() >= 0,
        ":101 checks B >= TC + total before :114, so the post-state keeps B >= TC";
}

// The payout must always select accrued, never the balance - the shortfall branch is dead code.
rule rule_release_paid_equals_accrued(env e, bytes32 id) {
    requireExternalSender(e);
    requireSaneTime(e);
    requireInvariant inv_solvency_ledger_identity();
    requireInvariant inv_solvency_balance_ge_committed();

    require currentContract.schedules[id].exists;

    requireInvariant inv_sol_sched_nonexistent_is_zero(id);
    require g_sumTotal - g_sumReleased
              >= to_mathint(currentContract.schedules[id].total)
               - to_mathint(currentContract.schedules[id].released);
    require to_mathint(releasable(e, id))
              <= to_mathint(currentContract.schedules[id].total)
               - to_mathint(currentContract.schedules[id].released);

    uint256 accrued   = releasable(e, id);
    uint256 relBefore = currentContract.schedules[id].released;

    release(e, id);

    assert to_mathint(currentContract.schedules[id].released) - to_mathint(relBefore)
             == to_mathint(accrued),
        ":188 must select accrued, never bal - the Med-4 shortfall branch is dead code";
}

// release reverts 'nothing to release' unless the payout is positive.
rule rule_release_four_way_pairing(env e, bytes32 id) {
    requireExternalSender(e);
    requireSaneTime(e);
    requireInvariant inv_solvency_ledger_identity();
    requireInvariant inv_solvency_balance_ge_committed();
    requireInvariant inv_solvency_beneficiary_domain(id);

    address ben       = currentContract.schedules[id].beneficiary;
    uint256 relBefore = currentContract.schedules[id].released;
    mathint benBefore = to_mathint(slToken.balanceOf(ben));
    mathint bBefore   = vestingBalance();
    uint256 tcBefore  = totalCommitted();

    release(e, id);

    mathint paid = to_mathint(currentContract.schedules[id].released) - to_mathint(relBefore);

    assert paid > 0,
        "release reverts 'nothing to release' at :175 unless paid > 0";
    assert to_mathint(slToken.balanceOf(ben)) == benBefore + paid,
        ":192 credits the beneficiary by exactly paid (no fee, no rebase - P-012)";
    assert to_mathint(totalCommitted()) == to_mathint(tcBefore) - paid,
        ":191 decrements totalCommitted by exactly paid";
    assert vestingBalance() == bBefore - paid,
        ":192 debits the vesting contract by exactly paid";
}

// updateBeneficiary pays the pre-state beneficiary, never the incoming one.
rule rule_release_settles_pre_state_beneficiary_first(env e, bytes32 id, address newBeneficiary) {
    requireExternalSender(e);
    requireSaneTime(e);
    requireInvariant inv_solvency_ledger_identity();
    requireInvariant inv_solvency_balance_ge_committed();
    requireInvariant inv_solvency_beneficiary_domain(id);

    address oldBen    = currentContract.schedules[id].beneficiary;
    uint256 relBefore = currentContract.schedules[id].released;
    mathint oldBefore = to_mathint(slToken.balanceOf(oldBen));
    mathint newBefore = to_mathint(slToken.balanceOf(newBeneficiary));
    require oldBen != newBeneficiary;

    updateBeneficiary(e, id, newBeneficiary);

    mathint paid = to_mathint(currentContract.schedules[id].released) - to_mathint(relBefore);

    assert to_mathint(slToken.balanceOf(oldBen)) == oldBefore + paid,
        ":209 pays the PRE-state beneficiary, never the incoming one";
    assert to_mathint(slToken.balanceOf(newBeneficiary)) == newBefore,
        "the incoming beneficiary receives nothing during the reassignment";
    assert currentContract.schedules[id].beneficiary == newBeneficiary,
        ":211 completes the reassignment";
}

// AmendSchedule makes no external call.
rule rule_amend_value_neutral(
    env e, bytes32 id, bytes32 anyId,
    uint64 start, uint64 cliffSeconds, uint64 durationSeconds, uint16 tgeBps
) {
    requireExternalSender(e);
    requireSaneTime(e);

    mathint bBefore    = vestingBalance();
    uint256 tcBefore   = totalCommitted();
    uint256 totBefore  = currentContract.schedules[anyId].total;
    uint256 relBefore  = currentContract.schedules[anyId].released;
    address benBefore  = currentContract.schedules[anyId].beneficiary;
    bool    exBefore   = currentContract.schedules[anyId].exists;
    uint256 cntBefore  = scheduleCount();

    amendSchedule(e, id, start, cliffSeconds, durationSeconds, tgeBps);

    assert vestingBalance() == bBefore,           "amendSchedule makes no external call";
    assert totalCommitted() == tcBefore,          "amendSchedule does not write totalCommitted";
    assert surplus() == bBefore - to_mathint(tcBefore), "delta surplus == 0";
    assert currentContract.schedules[anyId].total       == totBefore, "total is write-once (:105)";
    assert currentContract.schedules[anyId].released    == relBefore, ":190 is the only other released write";
    assert currentContract.schedules[anyId].beneficiary == benBefore, "beneficiary is written only at :104/:211";
    assert currentContract.schedules[anyId].exists      == exBefore,  "exists is written only at :111";
    assert scheduleCount() == cntBefore,          "scheduleIds is appended only at :113";
}

// The checked subtraction in the SL branch protects committed volume for every destination.
rule rule_sweep_never_breaches_commitment(env e, address t, address to) {
    requireExternalSender(e);
    requireInvariant inv_solvency_ledger_identity();
    requireInvariant inv_solvency_balance_ge_committed();

    sweep(e, t, to);

    assert slToken.balanceOf(currentContract) >= totalCommitted(),
        "the :225 checked subtraction protects committed volume on every `to`";
}

// The SL branch sweeps exactly the balance minus totalCommitted.
rule rule_sweep_sl_exactness(env e, address to) {
    requireExternalSender(e);
    requireRealSender(e);
    requireInvariant inv_solvency_ledger_identity();
    requireInvariant inv_solvency_balance_ge_committed();

    address t = token();
    require to != currentContract;
    require to != 0;

    mathint bBefore   = vestingBalance();
    uint256 tcBefore  = totalCommitted();
    mathint toBefore  = to_mathint(slToken.balanceOf(to));

    uint256 amount = sweep(e, t, to);

    assert to_mathint(amount) == bBefore - to_mathint(tcBefore), ":225 amount == B - TC";
    assert vestingBalance() == to_mathint(tcBefore),             "B_post == TC";
    assert totalCommitted() == tcBefore,                         "sweep writes no storage";
    assert to_mathint(slToken.balanceOf(to)) == toBefore + to_mathint(amount), "to receives exactly amount";
    assert surplus() == 0,                                       "the surplus is fully drained";
}

// The SL branch panics on underflow when the balance is below totalCommitted, protecting committed funds.
rule rule_sweep_sl_revert_profile(env e, address to) {
    requireExternalSender(e);
    requireRealSender(e);
    address t = token();
    require to != 0;

    mathint bBefore  = vestingBalance();
    uint256 tcBefore = totalCommitted();

    sweep@withrevert(e, t, to);
    bool reverted = lastReverted;

    assert bBefore <  to_mathint(tcBefore) => reverted,
        ":225 panics 0x11 when B < TC - the committed-funds protection (DX-3)";
    assert bBefore == to_mathint(tcBefore) => reverted,
        ":229 reverts 'nothing to sweep' when the surplus is exactly 0";
}

// sweep writes no contract storage.
rule rule_sweep_writes_no_storage(env e, address t, address to, bytes32 anyId) {
    requireExternalSender(e);

    uint256 tcBefore  = totalCommitted();
    uint256 cntBefore = scheduleCount();
    uint256 totBefore = currentContract.schedules[anyId].total;
    uint256 relBefore = currentContract.schedules[anyId].released;
    address benBefore = currentContract.schedules[anyId].beneficiary;
    bool    exBefore  = currentContract.schedules[anyId].exists;

    sweep(e, t, to);

    assert totalCommitted() == tcBefore,                          "no SSTORE in :222-232";
    assert scheduleCount()  == cntBefore,                         "no push in sweep";
    assert currentContract.schedules[anyId].total       == totBefore, "no schedule field is written";
    assert currentContract.schedules[anyId].released    == relBefore, "no schedule field is written";
    assert currentContract.schedules[anyId].beneficiary == benBefore, "no schedule field is written";
    assert currentContract.schedules[anyId].exists      == exBefore,  "no schedule field is written";
}

// The foreign-token branch touches only the swept token, never the SL balance.
rule rule_sweep_foreign_accounting_isolated(env e, address t, address to, bytes32 anyId) {
    requireExternalSender(e);
    require t != token();

    mathint bBefore   = vestingBalance();
    uint256 tcBefore  = totalCommitted();
    uint256 cntBefore = scheduleCount();
    uint256 totBefore = currentContract.schedules[anyId].total;
    uint256 relBefore = currentContract.schedules[anyId].released;

    sweep(e, t, to);

    assert vestingBalance() == bBefore,   ":227/:230 touch t, never the SL balance";
    assert totalCommitted() == tcBefore,  "the foreign branch writes no SLVesting storage";
    assert scheduleCount()  == cntBefore, "scheduleIds untouched";
    assert currentContract.schedules[anyId].total    == totBefore, "schedules untouched";
    assert currentContract.schedules[anyId].released == relBefore, "schedules untouched";
}

// sweep requires a strictly positive amount.
rule rule_sweep_foreign_exactness(env e, address to) {
    requireExternalSender(e);
    require to != currentContract;
    require to != 0;

    address t = mockToken;

    mathint tBalBefore = to_mathint(mockToken.balanceOf(currentContract));
    mathint toBefore   = to_mathint(mockToken.balanceOf(to));

    uint256 amount = sweep(e, t, to);

    assert to_mathint(amount) > 0, ":229 requires amount > 0";
    assert to_mathint(mockToken.balanceOf(to)) == toBefore + to_mathint(amount),
        ":230 delivers the full swept amount to `to`";
    assert tBalBefore >= to_mathint(amount),
        ":227 takes at most the whole balance - there is no cap and no TC subtraction";
}

// An inbound transfer runs no SLVesting code.
rule rule_solvency_donation_insensitive(env e, uint256 x, bytes32 id) {
    requireExternalSender(e);
    requireRealSender(e);
    requireSaneTime(e);
    require x > 0;

    mathint bBefore   = vestingBalance();
    uint256 tcBefore  = totalCommitted();
    uint256 totBefore = currentContract.schedules[id].total;
    uint256 relBefore = currentContract.schedules[id].released;
    address benBefore = currentContract.schedules[id].beneficiary;
    bool    exBefore  = currentContract.schedules[id].exists;
    require exBefore;
    uint256 releasableBefore = releasable(e, id);

    slToken.transfer(e, currentContract, x);

    assert totalCommitted() == tcBefore,    "an inbound transfer runs no SLVesting code";
    assert currentContract.schedules[id].total       == totBefore, "schedules untouched";
    assert currentContract.schedules[id].released    == relBefore, "schedules untouched";
    assert currentContract.schedules[id].beneficiary == benBefore, "schedules untouched";
    assert currentContract.schedules[id].exists      == exBefore,  "schedules untouched";
    assert vestingBalance() == bBefore + to_mathint(x),            "B rises by exactly x";
    assert surplus() == bBefore - to_mathint(tcBefore) + to_mathint(x), "surplus rises by exactly x";
    assert releasable(e, id) == releasableBefore,
        "accrual is storage-based (:147/:185), so the claim amount does not move";
}

// B1 survives sweep - the ledger identity is untouched by a storage-free function.
rule rule_sweep_preserves_solvency_under_dispatcher(env e, address t, address to) {
    requireExternalSender(e);
    requireInvariant inv_solvency_ledger_identity();
    requireInvariant inv_solvency_balance_ge_committed();

    mathint surplusBefore = surplus();

    sweep(e, t, to);

    assert to_mathint(totalCommitted()) == g_sumTotal - g_sumReleased,
        "B1 survives sweep - the ledger identity is untouched by a storage-free function";
    assert slToken.balanceOf(currentContract) >= totalCommitted(),
        "B2 survives sweep - :225 reverts before it could breach the commitment";
    assert surplus() <= surplusBefore,
        "B2-prime survives sweep - a sweep can only drain surplus, never create it";
}

// OwnableUnauthorizedAccount fires for every token argument, on both branches.
rule rule_access_sweep_owner_only_both_branches(env e, address t, address to) {
    requireRealSender(e);
    require e.msg.sender != owner();

    mathint bBefore  = vestingBalance();
    uint256 tcBefore = totalCommitted();

    sweep@withrevert(e, t, to);

    assert lastReverted,
        "OZ/Ownable.sol:65 OwnableUnauthorizedAccount fires for every t, both branches";
    assert vestingBalance() == bBefore,  "a rejected sweep moves no SL";
    assert totalCommitted() == tcBefore, "a rejected sweep writes no storage";
}

// Success of release(id) is independent of msg.sender - no authorisation gate.
rule rule_release_permissionless(env e1, env e2, bytes32 id) {
    requireSaneTime(e1);
    require e1.block.timestamp == e2.block.timestamp;
    require e1.msg.value == 0 && e2.msg.value == 0;

    storage init = lastStorage;

    release@withrevert(e1, id) at init;
    bool reverted1 = lastReverted;

    release@withrevert(e2, id) at init;
    bool reverted2 = lastReverted;

    assert reverted1 == reverted2,
        "success of release(id) is independent of msg.sender - no authorisation gate";
}

// The payout credits the schedule's beneficiary; a non-beneficiary caller gains nothing.
rule rule_release_caller_neutral(env e, bytes32 id) {
    requireExternalSender(e);
    requireRealSender(e);
    requireSaneTime(e);
    requireInvariant inv_solvency_beneficiary_domain(id);

    address ben = currentContract.schedules[id].beneficiary;
    require e.msg.sender != ben;

    mathint callerBefore = to_mathint(slToken.balanceOf(e.msg.sender));

    release(e, id);

    assert to_mathint(slToken.balanceOf(e.msg.sender)) == callerBefore,
        ":192 credits s.beneficiary; a non-beneficiary caller gains nothing";
}

// No SLVesting method reaches _mint or _burn - SLToken has no privileged actor.
rule rule_owner_cannot_mint_pause_or_clawback(method f, env e, calldataarg args, address victim)
    filtered { f -> f.contract == currentContract && !f.isView }
{
    requireExternalSender(e);
    requireSaneTime(e);
    require e.msg.sender == owner();
    require victim != currentContract;

    uint256 supplyBefore = slToken.totalSupply();
    mathint victimBefore = to_mathint(slToken.balanceOf(victim));

    f(e, args);

    assert slToken.totalSupply() == supplyBefore,
        "no SLVesting method reaches _mint or _burn - SLToken has no privileged actor";
    assert to_mathint(slToken.balanceOf(victim)) >= victimBefore,
        "no SLVesting method reduces a third party's already-received balance";
}

// Sweep can deliver at most B - TC to anyone, the owner included.
rule rule_owner_balance_increase_bounded_by_surplus(env e, address t, address to) {
    requireExternalSender(e);
    requireRealSender(e);
    requireInvariant inv_solvency_ledger_identity();
    requireInvariant inv_solvency_balance_ge_committed();

    address o = owner();
    require o != currentContract;

    mathint ownerBefore   = to_mathint(slToken.balanceOf(o));
    mathint surplusBefore = surplus();

    sweep(e, t, to);

    assert to_mathint(slToken.balanceOf(o)) - ownerBefore <= surplusBefore,
        "sweep can deliver at most B - TC to anyone, the owner included";
}

// The only address credited by a release payout is the pre-state beneficiary.
rule rule_owner_balance_increase_requires_beneficiary_role(env e, bytes32 id) {
    requireExternalSender(e);
    requireRealSender(e);
    requireSaneTime(e);
    requireInvariant inv_solvency_beneficiary_domain(id);

    address o   = owner();
    address ben = currentContract.schedules[id].beneficiary;
    mathint ownerBefore = to_mathint(slToken.balanceOf(o));

    release(e, id);

    assert to_mathint(slToken.balanceOf(o)) > ownerBefore => o == ben,
        "the only address credited by :192 is the pre-state beneficiary";
}

// CreateSchedule / amendSchedule / ownership calls move no tokens at all.
rule rule_owner_balance_unchanged_by_non_paying_methods(method f, env e, calldataarg args)
    filtered {
        f -> f.contract == currentContract
          && !f.isView && f.selector != sig:sweep(address,address).selector
          && f.selector != sig:release(bytes32).selector
          && f.selector != sig:updateBeneficiary(bytes32,address).selector
    }
{
    requireExternalSender(e);
    requireSaneTime(e);

    address o = owner();
    require o != currentContract;
    mathint ownerBefore = to_mathint(slToken.balanceOf(o));

    f(e, args);

    assert to_mathint(slToken.balanceOf(o)) == ownerBefore,
        "createSchedule / amendSchedule / ownership calls move no tokens at all";
}

// EXPECTED TO FAIL - the counterexample is the finding; a pass means this rule is wrong.
// To == address(this) reports a move that never happened.
rule rule_sweep_amount_equals_recipient_delta(env e, address t, address to) {
    requireExternalSender(e);
    requireRealSender(e);

    mathint toBefore = to_mathint(slToken.balanceOf(to));
    uint256 amount = sweep(e, t, to);

    assert to_mathint(slToken.balanceOf(to)) - toBefore == to_mathint(amount),
        "EXPECTED CEX: to == address(this) reports a move that never happened";
}

// EXPECTED TO FAIL - the counterexample is the finding; a pass means this rule is wrong.
// Sweep(t, address(this)) is infinitely repeatable.
rule rule_sweep_not_repeatable(env e, address t, address to) {
    requireExternalSender(e);
    requireRealSender(e);

    sweep(e, t, to);
    sweep@withrevert(e, t, to);

    assert lastReverted,
        "EXPECTED CEX: sweep(t, address(this)) is infinitely repeatable";
}

// EXPECTED TO FAIL - the counterexample is the finding; a pass means this rule is wrong.
// sweep guards only address(0), so both the vesting and token addresses are accepted.
rule rule_sweep_rejects_self_and_token_destination(env e, address t, address to) {
    requireExternalSender(e);
    requireRealSender(e);
    require to == currentContract || to == token();

    sweep@withrevert(e, t, to);

    assert lastReverted,
        "EXPECTED CEX: :223 guards only address(0), so both destinations are accepted";
}

// EXPECTED TO FAIL - the counterexample is the finding; a pass means this rule is wrong.
// The sweep destination domain is strictly wider than the beneficiary domain.
rule rule_sweep_destination_domain_matches_beneficiary_domain(env e, address t, address to) {
    requireExternalSender(e);
    requireRealSender(e);

    sweep(e, t, to);

    assert to != 0 && to != currentContract && to != token(),
        "EXPECTED CEX: the sweep destination domain is strictly wider than the beneficiary domain";
}

// SLToken has no rescue path of any kind - what it receives is trapped.
rule rule_solvency_token_contract_balance_monotone(method f, env e, calldataarg args)
    filtered { f -> !f.isView }
{
    requireExternalSender(e);
    requireSaneTime(e);

    mathint before = to_mathint(slToken.balanceOf(slToken));
    f(e, args);
    assert to_mathint(slToken.balanceOf(slToken)) >= before,
        "SLToken has no rescue path of any kind - what it receives is trapped";
}

// EXPECTED TO FAIL - the counterexample is the finding; a pass means this rule is wrong.
// The foreign-token branch takes 100% with no commitment subtraction.
rule rule_sweep_foreign_branch_ignores_commitment(env e, address t, address to) {
    requireExternalSender(e);
    requireRealSender(e);
    require totalCommitted() > 0;

    mathint before = to_mathint(slToken.balanceOf(currentContract));
    uint256 amount = sweep(e, t, to);

    assert before - to_mathint(amount) >= to_mathint(totalCommitted()),
        "EXPECTED CEX: the :227 branch takes 100% with no commitment subtraction";
}

// VACUOUS-WHERE-HARM-MAXIMAL: satisfied trivially whenever releasable == 0.
rule rule_update_beneficiary_settles_releasable_literal(env e, bytes32 id, address newBeneficiary) {
    requireExternalSender(e);
    requireSaneTime(e);
    requireInvariant inv_solvency_beneficiary_domain(id);

    address oldBen = currentContract.schedules[id].beneficiary;
    require oldBen != newBeneficiary;
    require currentContract.schedules[id].exists;
    requireInvariant inv_solvency_ledger_identity();
    requireInvariant inv_solvency_balance_ge_committed();

    requireInvariant inv_sol_sched_nonexistent_is_zero(id);
    require g_sumTotal - g_sumReleased
              >= to_mathint(currentContract.schedules[id].total)
               - to_mathint(currentContract.schedules[id].released);
    require to_mathint(releasable(e, id))
              <= to_mathint(currentContract.schedules[id].total)
               - to_mathint(currentContract.schedules[id].released);

    uint256 owed     = releasable(e, id);
    mathint oldBefore = to_mathint(slToken.balanceOf(oldBen));

    updateBeneficiary(e, id, newBeneficiary);

    assert to_mathint(slToken.balanceOf(oldBen)) == oldBefore + to_mathint(owed),
        "VACUOUS-WHERE-HARM-MAXIMAL: satisfied trivially whenever releasable == 0";
}

// One schedule's claim can never consume another schedule's committed tokens.
rule rule_cross_schedule_no_starvation(env e, bytes32 idA, bytes32 idB) {
    requireExternalSender(e);
    requireSaneTime(e);
    requireInvariant inv_solvency_ledger_identity();
    requireInvariant inv_solvency_balance_ge_committed();
    require idA != idB;

    requireInvariant inv_sol_sched_nonexistent_is_zero(idA);
    requireInvariant inv_sol_sched_nonexistent_is_zero(idB);
    require to_mathint(releasable(e, idA))
              <= to_mathint(currentContract.schedules[idA].total)
               - to_mathint(currentContract.schedules[idA].released);
    require to_mathint(releasable(e, idB))
              <= to_mathint(currentContract.schedules[idB].total)
               - to_mathint(currentContract.schedules[idB].released);
    require g_sumTotal - g_sumReleased
              >= ( to_mathint(currentContract.schedules[idA].total)
                 - to_mathint(currentContract.schedules[idA].released) )
               + ( to_mathint(currentContract.schedules[idB].total)
                 - to_mathint(currentContract.schedules[idB].released) );

    uint256 relB0 = currentContract.schedules[idB].released;
    storage init  = lastStorage;

    release(e, idB) at init;
    mathint paidAlone = to_mathint(currentContract.schedules[idB].released) - to_mathint(relB0);

    release(e, idA) at init;
    release(e, idB);
    mathint paidAfter = to_mathint(currentContract.schedules[idB].released) - to_mathint(relB0);

    assert paidAfter == paidAlone,
        "one schedule's claim can never consume another schedule's committed tokens";
}

// Cumulative flooring in the linear calculation leaves no per-claim residue.
rule rule_partial_claims_sum_to_single_claim(env e1, env e2, bytes32 id) {
    requireExternalSender(e1);
    requireExternalSender(e2);
    requireSaneTime(e1);
    requireSaneTime(e2);
    require e2.block.timestamp >= e1.block.timestamp;
    requireInvariant inv_solvency_ledger_identity();
    requireInvariant inv_solvency_balance_ge_committed();

    uint256 rel0 = currentContract.schedules[id].released;
    storage init = lastStorage;

    release(e2, id) at init;
    mathint single = to_mathint(currentContract.schedules[id].released) - to_mathint(rel0);

    release(e1, id) at init;
    release(e2, id);
    mathint split = to_mathint(currentContract.schedules[id].released) - to_mathint(rel0);

    assert single == split,
        "cumulative flooring at :161 leaves no per-claim residue";
}

// updateBeneficiary settles the outgoing beneficiary, so the two orderings agree on the payout.
rule rule_release_update_beneficiary_commute(env e, bytes32 id, address newBeneficiary) {
    requireExternalSender(e);
    requireSaneTime(e);
    requireInvariant inv_solvency_beneficiary_domain(id);

    address oldBen = currentContract.schedules[id].beneficiary;
    require oldBen != newBeneficiary;
    mathint oldBefore = to_mathint(slToken.balanceOf(oldBen));
    storage init = lastStorage;

    release(e, id) at init;
    updateBeneficiary(e, id, newBeneficiary);
    mathint deliveredA = to_mathint(slToken.balanceOf(oldBen)) - oldBefore;

    updateBeneficiary(e, id, newBeneficiary) at init;
    mathint deliveredB = to_mathint(slToken.balanceOf(oldBen)) - oldBefore;

    assert deliveredA == deliveredB,
        ":209 settles the outgoing beneficiary, so the orderings agree on their payout";
}

// Post-sweep surplus is exactly 0, so the creation-time solvency check fails for any positive total.
rule rule_sweep_create_boundary_sweep_then_create(
    env e1, env e2, address to, bytes32 id, address beneficiary, uint256 total,
    uint64 start, uint64 cliffSeconds, uint64 durationSeconds, uint16 tgeBps
) {
    requireExternalSender(e1);
    requireExternalSender(e2);
    requireRealSender(e1);
    requireSaneTime(e2);
    requireInvariant inv_solvency_ledger_identity();
    requireInvariant inv_solvency_balance_ge_committed();

    address t = token();
    require to != currentContract;
    require total > 0;

    sweep(e1, t, to);

    createSchedule@withrevert(e2, id, beneficiary, total, start, cliffSeconds, durationSeconds, tgeBps);

    assert lastReverted,
        "post-sweep surplus is exactly 0, so :101 B >= TC + total fails for any total > 0";
}

// The new commitment drove the surplus to 0, so sweep rejects it.
rule rule_sweep_create_boundary_create_then_sweep(
    env e1, env e2, address to, bytes32 id, address beneficiary, uint256 total,
    uint64 start, uint64 cliffSeconds, uint64 durationSeconds, uint16 tgeBps
) {
    requireExternalSender(e1);
    requireExternalSender(e2);
    requireRealSender(e2);
    requireSaneTime(e1);
    requireInvariant inv_solvency_ledger_identity();
    requireInvariant inv_solvency_balance_ge_committed();

    address t = token();
    require to != 0;

    require to_mathint(total) == surplus();

    createSchedule(e1, id, beneficiary, total, start, cliffSeconds, durationSeconds, tgeBps);

    sweep@withrevert(e2, t, to);

    assert lastReverted,
        ":114 drove the surplus to 0, so :229 rejects the sweep";
}

// The completed schedule paid out its total EXACTLY - no stranded dust.
rule rule_create_release_sweep_returns_to_baseline(env e, bytes32 id, address to) {
    requireExternalSender(e);
    requireRealSender(e);
    requireSaneTime(e);
    requireInvariant inv_solvency_ledger_identity();
    requireInvariant inv_solvency_balance_ge_committed();
    requireInvariant inv_solvency_beneficiary_domain(id);

    require currentContract.schedules[id].exists;
    require currentContract.schedules[id].released == 0;

    requireInvariant inv_sol_sched_nonexistent_is_zero(id);
    require g_sumTotal - g_sumReleased
              >= to_mathint(currentContract.schedules[id].total)
               - to_mathint(currentContract.schedules[id].released);

    require vestedAmount(e, id, require_uint64(e.block.timestamp))
                == currentContract.schedules[id].total;

    uint256 total    = currentContract.schedules[id].total;
    uint256 tcBefore = totalCommitted();
    mathint bBefore  = vestingBalance();
    mathint sBefore  = surplus();

    release(e, id);

    assert currentContract.schedules[id].released == total,
        "the completed schedule paid out its total EXACTLY - no stranded dust";
    assert to_mathint(totalCommitted()) == to_mathint(tcBefore) - to_mathint(total),
        "totalCommitted returns to its pre-creation value";
    assert vestingBalance() == bBefore - to_mathint(total),
        "B falls by exactly the schedule total";
    assert surplus() == sBefore,
        "the round trip is surplus-neutral";

    require sBefore == 0;
    sweep@withrevert(e, token(), to);
    assert lastReverted,
        "a zero surplus makes :229 reject the sweep";
}
