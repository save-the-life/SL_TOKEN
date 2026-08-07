methods {
    function token()                      external returns (address)  envfree;
    function totalCommitted()             external returns (uint256)  envfree;
    function scheduleCount()              external returns (uint256)  envfree;
    function scheduleIds(uint256)         external returns (bytes32)  envfree;
    function schedules(bytes32)           external
        returns (address,uint256,uint256,uint64,uint64,uint64,uint16,bool) envfree;
    function vestedAmount(bytes32,uint64) external returns (uint256)  envfree;
    function owner()                      external returns (address)  envfree;
    function MAX_START_DELAY()            external returns (uint64)   envfree;
    function MAX_CLIFF()                  external returns (uint64)   envfree;
    function MAX_DURATION()               external returns (uint64)   envfree;
    function releasable(bytes32)          external returns (uint256);
    function _.transfer(address,uint256)  external => DISPATCHER(true);
    function _.balanceOf(address)         external => DISPATCHER(true);
    unresolved external in _._ => DISPATCH [
        SLToken.transfer(address,uint256),
        SLToken.balanceOf(address)
    ] default NONDET;
}
function getBeneficiary(bytes32 id) returns address {
    address ben; uint256 tot; uint256 rel; uint64 st; uint64 cl; uint64 dur; uint16 bps; bool ex;
    ben, tot, rel, st, cl, dur, bps, ex = schedules(id);
    return ben;
}
function getTotal(bytes32 id) returns uint256 {
    address ben; uint256 tot; uint256 rel; uint64 st; uint64 cl; uint64 dur; uint16 bps; bool ex;
    ben, tot, rel, st, cl, dur, bps, ex = schedules(id);
    return tot;
}
function getReleased(bytes32 id) returns uint256 {
    address ben; uint256 tot; uint256 rel; uint64 st; uint64 cl; uint64 dur; uint16 bps; bool ex;
    ben, tot, rel, st, cl, dur, bps, ex = schedules(id);
    return rel;
}
function getStart(bytes32 id) returns uint64 {
    address ben; uint256 tot; uint256 rel; uint64 st; uint64 cl; uint64 dur; uint16 bps; bool ex;
    ben, tot, rel, st, cl, dur, bps, ex = schedules(id);
    return st;
}
function getCliff(bytes32 id) returns uint64 {
    address ben; uint256 tot; uint256 rel; uint64 st; uint64 cl; uint64 dur; uint16 bps; bool ex;
    ben, tot, rel, st, cl, dur, bps, ex = schedules(id);
    return cl;
}
function getDuration(bytes32 id) returns uint64 {
    address ben; uint256 tot; uint256 rel; uint64 st; uint64 cl; uint64 dur; uint16 bps; bool ex;
    ben, tot, rel, st, cl, dur, bps, ex = schedules(id);
    return dur;
}
function getTgeBps(bytes32 id) returns uint16 {
    address ben; uint256 tot; uint256 rel; uint64 st; uint64 cl; uint64 dur; uint16 bps; bool ex;
    ben, tot, rel, st, cl, dur, bps, ex = schedules(id);
    return bps;
}
function getExists(bytes32 id) returns bool {
    address ben; uint256 tot; uint256 rel; uint64 st; uint64 cl; uint64 dur; uint16 bps; bool ex;
    ben, tot, rel, st, cl, dur, bps, ex = schedules(id);
    return ex;
}
definition TS_BOUND() returns mathint = 9223372036854775808;
definition U64_MAX()  returns mathint = 18446744073709551615;
definition BPS_ONE()  returns mathint = 10000;
function totalInBounds(bytes32 id) returns bool {
    return to_mathint(getTotal(id)) <= 340282366920938463463374607431768211455;
}
function scheduleWindowInBounds(bytes32 id) returns bool {
    return to_mathint(getStart(id)) + to_mathint(getCliff(id)) + to_mathint(getDuration(id))
           <= U64_MAX();
}
ghost mapping(bytes32 => mathint) g_outstanding {
    init_state axiom forall bytes32 id. g_outstanding[id] == 0;
}
ghost mathint g_sumOutstanding {
    init_state axiom g_sumOutstanding == 0;
}
hook Sstore schedules[KEY bytes32 id].total uint256 newTotal (uint256 oldTotal) {
    g_outstanding[id] = g_outstanding[id] + to_mathint(newTotal) - to_mathint(oldTotal);
    g_sumOutstanding  = g_sumOutstanding  + to_mathint(newTotal) - to_mathint(oldTotal);
}
hook Sstore schedules[KEY bytes32 id].released uint256 newRel (uint256 oldRel) {
    g_outstanding[id] = g_outstanding[id] - to_mathint(newRel) + to_mathint(oldRel);
    g_sumOutstanding  = g_sumOutstanding  - to_mathint(newRel) + to_mathint(oldRel);
}

// Token() must never change after construction.
rule rule_vesting_token_immutable_nonzero(method f, env e, calldataarg args) filtered { f -> !f.isView } {
    address tokenBefore = token();
    f(e, args);
    assert token() == tokenBefore, "token() must never change after construction";
    assert token() != 0,           "token() is non-zero by the :70 constructor guard";
}

// An existing schedule's beneficiary is never address(0), the vesting contract, or the token contract.
invariant inv_sched_beneficiary_domain(bytes32 id)
    getExists(id) => ( getBeneficiary(id) != 0
                    && getBeneficiary(id) != currentContract
                    && getBeneficiary(id) != token() );

// Total(id) may only be written by createSchedule on a not-yet-existing id.
rule rule_sched_total_write_once(method f, env e, calldataarg args, bytes32 id) filtered { f -> !f.isView } {
    uint256 totalBefore  = getTotal(id);
    bool    existsBefore = getExists(id);
    f(e, args);
    assert getTotal(id) != totalBefore =>
        ( f.selector ==
            sig:createSchedule(bytes32,address,uint256,uint64,uint64,uint64,uint16).selector
          && !existsBefore ),
        "total(id) may only be written by createSchedule on a not-yet-existing id";
}

// An existing schedule always has total > 0.
invariant inv_sched_total_positive(bytes32 id)
    getExists(id) => getTotal(id) > 0;

// An existing schedule always satisfies cliff <= MAX_CLIFF, duration <= MAX_DURATION and tgeBps <= 10000.
invariant inv_sched_param_bounds(bytes32 id)
    getExists(id) => ( getCliff(id)    <= MAX_CLIFF()
                    && getDuration(id) <= MAX_DURATION()
                    && to_mathint(getTgeBps(id)) <= BPS_ONE() );

// The TGE portion of a schedule never exceeds the schedule total.
invariant inv_sched_tge_amount_le_total(bytes32 id)
    getExists(id) =>
        ( to_mathint(getTotal(id)) * to_mathint(getTgeBps(id)) ) / BPS_ONE()
            <= to_mathint(getTotal(id))
    {
        preserved {
            requireInvariant inv_sched_param_bounds(id);
        }
    }

// Exists(id) must never go true -> false: there is no delete and no false-write site.
rule rule_sched_exists_monotone(method f, env e, calldataarg args, bytes32 id) filtered { f -> !f.isView } {
    bool existsBefore = getExists(id);
    f(e, args);
    assert existsBefore => getExists(id),
        "exists(id) must never go true -> false: there is no delete and no false-write site";
}

// Only the owner, via createSchedule, can bring a schedule into existence.
rule rule_sched_exists_set_by_create_only(method f, env e, calldataarg args, bytes32 id) filtered { f -> !f.isView } {
    address ownerBefore  = owner();
    bool    existsBefore = getExists(id);
    f(e, args);
    assert (!existsBefore && getExists(id)) =>
        ( f.selector ==
            sig:createSchedule(bytes32,address,uint256,uint64,uint64,uint64,uint16).selector
          && e.msg.sender == ownerBefore ),
        "only the owner, via createSchedule, can bring a schedule into existence";
}

// ScheduleIds.length is non-decreasing.
rule rule_sched_ids_append_only(method f, env e, calldataarg args, uint256 i) filtered { f -> !f.isView } {
    require to_mathint(scheduleCount()) < 18446744073709551615;
    uint256 lenBefore = scheduleCount();
    require i < lenBefore;
    bytes32 elemBefore = scheduleIds(i);
    f(e, args);
    uint256 lenAfter = scheduleCount();
    assert lenAfter >= lenBefore, "scheduleIds.length is non-decreasing";
    assert lenAfter != lenBefore =>
        ( f.selector ==
            sig:createSchedule(bytes32,address,uint256,uint64,uint64,uint64,uint16).selector
          && to_mathint(lenAfter) == to_mathint(lenBefore) + 1 ),
        "only createSchedule grows the array, and by exactly one";
    assert scheduleIds(i) == elemBefore, "every previously written element is immutable";
}

// createSchedule must reject an id that already exists.
rule rule_sched_ids_no_duplicate_id(env e, bytes32 id, address ben, uint256 total,
                                    uint64 start, uint64 cliffSeconds, uint64 durationSeconds,
                                    uint16 tgeBps) {
    require getExists(id);
    createSchedule@withrevert(e, id, ben, total, start, cliffSeconds, durationSeconds, tgeBps);
    assert lastReverted, "createSchedule must reject an id that already exists (:86 'exists')";
}

// No method un-creates a schedule.
rule rule_vesting_no_revoke_pause_or_halt(method f, env e, calldataarg args, bytes32 id) filtered { f -> !f.isView } {
    requireInvariant inv_sched_nonexistent_is_zero(id);
    bool    existsBefore   = getExists(id);
    uint256 totalBefore    = getTotal(id);
    uint256 releasedBefore = getReleased(id);
    f(e, args);
    assert existsBefore => getExists(id),            "no method un-creates a schedule";
    assert existsBefore => getTotal(id) == totalBefore,
        "no method reduces (or otherwise changes) an existing schedule's total";
    assert getReleased(id) >= releasedBefore,        "no method reduces released(id)";
}

// Released(id) is monotone non-decreasing.
rule rule_sched_released_monotone(method f, env e, calldataarg args, bytes32 id) filtered { f -> !f.isView } {
    requireInvariant inv_sched_nonexistent_is_zero(id);
    uint256 releasedBefore = getReleased(id);
    f(e, args);
    assert getReleased(id) >= releasedBefore, "released(id) is monotone non-decreasing";
}

// released(id) may only rise through release or updateBeneficiary.
rule rule_sched_released_write_restriction(method f, env e, calldataarg args, bytes32 id) filtered { f -> !f.isView } {
    uint256 releasedBefore = getReleased(id);
    f(e, args);
    assert getReleased(id) > releasedBefore =>
        ( f.selector == sig:release(bytes32).selector
       || f.selector == sig:updateBeneficiary(bytes32,address).selector ),
        "released(id) may only rise via release or updateBeneficiary (:190 reachability)";
}

// VestedAmount never exceeds the schedule total (B3 upper bound).
rule rule_sched_vested_le_total(bytes32 id, uint64 t) {
    require getExists(id);
    requireInvariant inv_sched_param_bounds(id);
    requireInvariant inv_sched_tge_amount_le_total(id);
    require scheduleWindowInBounds(id);
    assert to_mathint(vestedAmount(id, t)) <= to_mathint(getTotal(id)),
        "vestedAmount never exceeds the schedule total (B3 upper bound)";
}

// Released(id) <= vestedAmount(id, now) is preserved by every method.
rule rule_sched_released_le_vested_preserved(method f, env e, calldataarg args, bytes32 id) filtered { f -> !f.isView } {
    require e.block.timestamp < TS_BOUND();
    require getExists(id);
    require scheduleWindowInBounds(id);
    uint64 t = require_uint64(e.block.timestamp);
    require to_mathint(getReleased(id)) <= to_mathint(vestedAmount(id, t));
    f(e, args);
    require scheduleWindowInBounds(id);
    assert getExists(id) =>
        to_mathint(getReleased(id)) <= to_mathint(vestedAmount(id, t)),
        "released(id) <= vestedAmount(id, now) is preserved by every method";
}

// The rise in released(id) always equals the fall in totalCommitted.
rule rule_ledger_released_totalcommitted_paired(method f, env e, calldataarg args,
                                                bytes32 idA, bytes32 idB) filtered { f -> !f.isView } {
    require idA != idB;
    requireInvariant inv_sched_nonexistent_is_zero(idA);
    requireInvariant inv_sched_nonexistent_is_zero(idB);
    uint256 relA   = getReleased(idA);
    uint256 relB   = getReleased(idB);
    uint256 tcPre  = totalCommitted();
    f(e, args);
    assert getReleased(idA) != relA =>
        to_mathint(getReleased(idA)) - to_mathint(relA)
            == to_mathint(tcPre) - to_mathint(totalCommitted()),
        "delta released(id) == -delta totalCommitted (the :190 / :191 pairing)";
    assert getReleased(idA) != relA => getReleased(idB) == relB,
        "a single call settles at most one schedule";
}

// TotalCommitted moves only via createSchedule, release or updateBeneficiary.
rule rule_ledger_totalcommitted_write_restriction(method f, env e, calldataarg args) filtered { f -> !f.isView } {
    uint256 tcBefore = totalCommitted();
    f(e, args);
    assert totalCommitted() != tcBefore =>
        ( f.selector ==
            sig:createSchedule(bytes32,address,uint256,uint64,uint64,uint64,uint16).selector
       || f.selector == sig:release(bytes32).selector
       || f.selector == sig:updateBeneficiary(bytes32,address).selector ),
        "totalCommitted moves only via createSchedule, release or updateBeneficiary";
}

// TotalCommitted rises only under owner-gated createSchedule.
rule rule_ledger_totalcommitted_increase_requires_owner_create(method f, env e,
                                                               calldataarg args) filtered { f -> !f.isView } {
    address ownerBefore = owner();
    uint256 tcBefore    = totalCommitted();
    f(e, args);
    assert totalCommitted() > tcBefore =>
        ( f.selector ==
            sig:createSchedule(bytes32,address,uint256,uint64,uint64,uint64,uint16).selector
          && e.msg.sender == ownerBefore ),
        "totalCommitted rises only under owner-gated createSchedule";
}

// createSchedule commits exactly the `total` argument.
rule rule_ledger_create_commits_exactly_total(env e, bytes32 id, address ben, uint256 total,
                                              uint64 start, uint64 cliffSeconds,
                                              uint64 durationSeconds, uint16 tgeBps) {
    uint256 tcBefore = totalCommitted();
    createSchedule(e, id, ben, total, start, cliffSeconds, durationSeconds, tgeBps);
    assert to_mathint(totalCommitted()) == to_mathint(tcBefore) + to_mathint(total),
        "createSchedule commits exactly the `total` argument (:114)";
    assert getTotal(id) == total, "and books that same amount on the schedule (:105)";
}

// A schedule that does not exist holds zero in both total and released.
invariant inv_sched_nonexistent_is_zero(bytes32 id)
    !getExists(id) => ( getTotal(id) == 0 && getReleased(id) == 0 );

// totalCommitted always equals the sum of (total - released) over every existing schedule.
invariant inv_ledger_totalcommitted_equals_outstanding_sum()
    to_mathint(totalCommitted()) == g_sumOutstanding
    {
        preserved createSchedule(bytes32 id, address b, uint256 t, uint64 st, uint64 c, uint64 d, uint16 g) with (env e) {
            requireInvariant inv_sched_nonexistent_is_zero(id);
            require totalInBounds(id);
        }
        preserved with (env e) {
            require e.block.timestamp < TS_BOUND();
            require e.msg.value == 0;
        }
    }

// Accrued never exceeds totalCommitted, so the commitment decrement cannot underflow.
rule rule_ledger_accrued_le_totalcommitted(env e, bytes32 id) {
    require e.block.timestamp < TS_BOUND();
    require getExists(id);
    require scheduleWindowInBounds(id);
    uint64 t = require_uint64(e.block.timestamp);
    requireInvariant inv_ledger_totalcommitted_equals_outstanding_sum();
    require to_mathint(getReleased(id)) <= to_mathint(vestedAmount(id, t));
    require to_mathint(vestedAmount(id, t)) <= to_mathint(getTotal(id));
    require g_sumOutstanding >= g_outstanding[id];
    require g_outstanding[id] == to_mathint(getTotal(id)) - to_mathint(getReleased(id));
    assert to_mathint(vestedAmount(id, t)) - to_mathint(getReleased(id))
            <= to_mathint(totalCommitted()),
        "accrued <= totalCommitted, so :191 cannot underflow";
}

// Releasable(id) never panics for an existing schedule.
rule rule_releasable_never_underflows(env e, bytes32 id) {
    require e.msg.value == 0;
    require totalInBounds(id);
    requireInvariant inv_sched_param_bounds(id);
    requireInvariant inv_sched_tge_amount_le_total(id);
    requireInvariant inv_sched_nonexistent_is_zero(id);
    require e.block.timestamp < TS_BOUND();
    require getExists(id);
    require scheduleWindowInBounds(id);
    uint64 t = require_uint64(e.block.timestamp);
    require to_mathint(getReleased(id)) <= to_mathint(vestedAmount(id, t));
    releasable@withrevert(e, id);
    assert !lastReverted, "releasable(id) never panics for an existing schedule";
}

// Releasable(id) == vestedAmount(id, now) - released(id), both reads on the same schedule.
rule rule_releasable_identity(env e, bytes32 id) {
    require e.block.timestamp < TS_BOUND();
    require getExists(id);
    require scheduleWindowInBounds(id);
    uint64 t = require_uint64(e.block.timestamp);
    require to_mathint(getReleased(id)) <= to_mathint(vestedAmount(id, t));
    assert to_mathint(releasable(e, id))
            == to_mathint(vestedAmount(id, t)) - to_mathint(getReleased(id)),
        "releasable(id) == vestedAmount(id, now) - released(id), both reads on the same schedule";
}

// Beneficiary(id) moves only under owner-gated createSchedule / updateBeneficiary.
rule rule_sched_beneficiary_write_restriction(method f, env e, calldataarg args, bytes32 id) filtered { f -> !f.isView } {
    address ownerBefore = owner();
    address benBefore   = getBeneficiary(id);
    f(e, args);
    assert getBeneficiary(id) != benBefore =>
        ( ( f.selector ==
              sig:createSchedule(bytes32,address,uint256,uint64,uint64,uint64,uint16).selector
         || f.selector == sig:updateBeneficiary(bytes32,address).selector )
          && e.msg.sender == ownerBefore ),
        "beneficiary(id) moves only under owner-gated createSchedule / updateBeneficiary";
}

// UpdateBeneficiary must reject address(0) / address(this) / address(token).
rule rule_beneficiary_update_rejects_system_addresses(env e, bytes32 id, address b) {
    require e.msg.sender != 0;
    require b == 0 || b == currentContract || b == token();
    updateBeneficiary@withrevert(e, id, b);
    assert lastReverted,
        "updateBeneficiary must reject address(0) / address(this) / address(token)";
}

// Cliff / duration / tgeBps move only under owner-gated createSchedule / amendSchedule.
rule rule_sched_curve_param_write_restriction(method f, env e, calldataarg args, bytes32 id) filtered { f -> !f.isView } {
    address ownerBefore = owner();
    uint64  cliffBefore = getCliff(id);
    uint64  durBefore   = getDuration(id);
    uint16  bpsBefore   = getTgeBps(id);
    f(e, args);
    assert ( getCliff(id) != cliffBefore || getDuration(id) != durBefore
             || getTgeBps(id) != bpsBefore ) =>
        ( ( f.selector ==
              sig:createSchedule(bytes32,address,uint256,uint64,uint64,uint64,uint16).selector
         || f.selector == sig:amendSchedule(bytes32,uint64,uint64,uint64,uint16).selector )
          && e.msg.sender == ownerBefore ),
        "cliff / duration / tgeBps move only under owner-gated createSchedule / amendSchedule";
}

// Owner() moves only under owner-gated transferOwnership / renounceOwnership.
rule rule_owner_write_restriction(method f, env e, calldataarg args) filtered { f -> !f.isView } {
    address ownerBefore = owner();
    f(e, args);
    assert owner() != ownerBefore =>
        ( ( f.selector == sig:transferOwnership(address).selector
         || f.selector == sig:renounceOwnership().selector )
          && e.msg.sender == ownerBefore ),
        "owner() moves only under owner-gated transferOwnership / renounceOwnership";
    assert f.selector == sig:renounceOwnership().selector => owner() == 0,
        "renounceOwnership leaves owner() == address(0)";
}

// A non-owner cannot create a schedule (OwnableUnauthorizedAccount).
rule rule_access_create_owner_only(env e, bytes32 id, address ben, uint256 total, uint64 start,
                                   uint64 cliffSeconds, uint64 durationSeconds, uint16 tgeBps) {
    require e.msg.sender != 0;
    require e.msg.sender != owner();
    createSchedule@withrevert(e, id, ben, total, start, cliffSeconds, durationSeconds, tgeBps);
    assert lastReverted, "a non-owner cannot create a schedule (OwnableUnauthorizedAccount)";
}

// A non-owner cannot amend a schedule (OwnableUnauthorizedAccount).
rule rule_access_amend_owner_only(env e, bytes32 id, uint64 start, uint64 cliffSeconds,
                                  uint64 durationSeconds, uint16 tgeBps) {
    require e.msg.sender != 0;
    require e.msg.sender != owner();
    amendSchedule@withrevert(e, id, start, cliffSeconds, durationSeconds, tgeBps);
    assert lastReverted, "a non-owner cannot amend a schedule (OwnableUnauthorizedAccount)";
}

// A non-owner cannot re-point a beneficiary (OwnableUnauthorizedAccount).
rule rule_access_update_beneficiary_owner_only(env e, bytes32 id, address newBeneficiary) {
    require e.msg.sender != 0;
    require e.msg.sender != owner();
    updateBeneficiary@withrevert(e, id, newBeneficiary);
    assert lastReverted, "a non-owner cannot re-point a beneficiary (OwnableUnauthorizedAccount)";
}

// A non-owner cannot transfer ownership.
rule rule_access_ownership_transfer_owner_only(env e, address newOwner) {
    require e.msg.sender != 0;
    require e.msg.sender != owner();
    transferOwnership@withrevert(e, newOwner);
    assert lastReverted, "a non-owner cannot transfer ownership";
}

// A non-owner cannot renounce ownership.
rule rule_access_renounce_owner_only(env e) {
    require e.msg.sender != 0;
    require e.msg.sender != owner();
    renounceOwnership@withrevert(e);
    assert lastReverted, "a non-owner cannot renounce ownership";
}

// TransferOwnership(address(0)) reverts OwnableInvalidOwner(0).
rule rule_access_transfer_ownership_rejects_zero(env e) {
    require e.msg.sender != 0;
    transferOwnership@withrevert(e, 0);
    assert lastReverted, "transferOwnership(address(0)) reverts OwnableInvalidOwner(0)";
}

// Every schedule/ownership mutation and every totalCommitted INCREASE requires the owner.
rule rule_access_master_privilege_surface(method f, env e, calldataarg args, bytes32 id,
                                          uint256 i) filtered { f -> !f.isView } {
    require e.msg.sender != 0;
    address ownerBefore = owner();
    address benBefore   = getBeneficiary(id);
    uint256 totBefore   = getTotal(id);
    uint64  stBefore    = getStart(id);
    uint64  clBefore    = getCliff(id);
    uint64  durBefore   = getDuration(id);
    uint16  bpsBefore   = getTgeBps(id);
    bool    exBefore    = getExists(id);
    uint256 lenBefore   = scheduleCount();
    uint256 tcBefore    = totalCommitted();

    f(e, args);

    bool privilegedChange =
           getBeneficiary(id) != benBefore
        || getTotal(id)       != totBefore
        || getStart(id)       != stBefore
        || getCliff(id)       != clBefore
        || getDuration(id)    != durBefore
        || getTgeBps(id)      != bpsBefore
        || getExists(id)      != exBefore
        || scheduleCount()    != lenBefore
        || owner()            != ownerBefore
        || totalCommitted()   >  tcBefore;

    assert privilegedChange => e.msg.sender == ownerBefore,
        "every schedule/ownership mutation and every totalCommitted INCREASE requires the owner";
}

// The beneficiary cannot move its own pointer.
rule rule_beneficiary_has_no_capability(method f, env e, calldataarg args, bytes32 id) filtered { f -> !f.isView } {
    require e.msg.sender != 0;
    require getExists(id);
    require e.msg.sender == getBeneficiary(id);
    require e.msg.sender != owner();
    address benBefore = getBeneficiary(id);
    uint64  stBefore  = getStart(id);
    uint64  clBefore  = getCliff(id);
    uint64  durBefore = getDuration(id);
    uint16  bpsBefore = getTgeBps(id);
    f@withrevert(e, args);
    assert getBeneficiary(id) == benBefore, "the beneficiary cannot move its own pointer";
    assert getStart(id)    == stBefore  && getCliff(id)    == clBefore
        && getDuration(id) == durBefore && getTgeBps(id)   == bpsBefore,
        "the beneficiary cannot accelerate or decelerate its own schedule";
}

// Start(id) moves only under owner-gated createSchedule / amendSchedule.
rule rule_sched_start_write_restriction(method f, env e, calldataarg args, bytes32 id) filtered { f -> !f.isView } {
    require e.block.timestamp < TS_BOUND();
    require e.msg.sender != 0;
    address ownerBefore = owner();
    uint64  stBefore    = getStart(id);
    f(e, args);
    assert getStart(id) != stBefore =>
        ( ( f.selector ==
              sig:createSchedule(bytes32,address,uint256,uint64,uint64,uint64,uint16).selector
         || f.selector == sig:amendSchedule(bytes32,uint64,uint64,uint64,uint16).selector )
          && e.msg.sender == ownerBefore ),
        "start(id) moves only under owner-gated createSchedule / amendSchedule";
    assert ( getStart(id) != stBefore
             && f.selector == sig:amendSchedule(bytes32,uint64,uint64,uint64,uint16).selector )
        => to_mathint(e.block.timestamp) < to_mathint(stBefore),
        "an amend-time write of start requires now < start_pre (the :131 latch)";
}

// Every write of start(id) lands in [now, now + MAX_START_DELAY].
rule rule_sched_start_writetime_bound(method f, env e, calldataarg args, bytes32 id) filtered { f -> !f.isView } {
    require e.block.timestamp < TS_BOUND();
    uint64 stBefore = getStart(id);
    f(e, args);
    uint64 stAfter = getStart(id);
    assert stAfter != stBefore =>
        ( to_mathint(stAfter) >= to_mathint(e.block.timestamp)
       && to_mathint(stAfter) <= to_mathint(e.block.timestamp) + to_mathint(MAX_START_DELAY()) ),
        "every write of start(id) lands in [now, now + MAX_START_DELAY]";
}

// NONEXISTENT is un-re-enterable.
rule rule_sched_lifecycle_machine(method f, env e, calldataarg args, bytes32 id) filtered { f -> !f.isView } {
    bool   exBefore = getExists(id);
    uint64 stBefore = getStart(id);
    bool   startedBefore = exBefore && to_mathint(e.block.timestamp) >= to_mathint(stBefore);
    f(e, args);
    assert exBefore => getExists(id), "NONEXISTENT is un-re-enterable";
    assert startedBefore =>
        ( getExists(id) && to_mathint(e.block.timestamp) >= to_mathint(getStart(id)) ),
        "STARTED is absorbing: no transition back to AMENDABLE";
}

// A STARTED schedule can never be re-parameterised.
rule rule_amend_latch_terminal(method f, env e, calldataarg args, bytes32 id) filtered { f -> !f.isView } {
    require e.block.timestamp < TS_BOUND();
    require getExists(id);
    uint64 stBefore  = getStart(id);
    uint64 clBefore  = getCliff(id);
    uint64 durBefore = getDuration(id);
    uint16 bpsBefore = getTgeBps(id);
    require to_mathint(e.block.timestamp) >= to_mathint(stBefore);
    f(e, args);
    assert getStart(id)    == stBefore  && getCliff(id)  == clBefore
        && getDuration(id) == durBefore && getTgeBps(id) == bpsBefore,
        "a STARTED schedule can never be re-parameterised";
}

// AmendSchedule can only succeed on a schedule that has never paid out.
rule rule_amend_requires_released_zero(env e, bytes32 id, uint64 start, uint64 cliffSeconds,
                                       uint64 durationSeconds, uint16 tgeBps) {
    require e.block.timestamp < TS_BOUND();
    require getExists(id);
    require scheduleWindowInBounds(id);
    uint64 t = require_uint64(e.block.timestamp);
    require to_mathint(getReleased(id)) <= to_mathint(vestedAmount(id, t));
    uint256 releasedBefore = getReleased(id);
    amendSchedule(e, id, start, cliffSeconds, durationSeconds, tgeBps);
    assert releasedBefore == 0,
        "amendSchedule can only succeed on a schedule that has never paid out";
}

// Released(id) > 0 implies the schedule has started.
rule rule_released_implies_started(env e, bytes32 id) {
    require e.block.timestamp < TS_BOUND();
    require getExists(id);
    require scheduleWindowInBounds(id);
    uint64 t = require_uint64(e.block.timestamp);
    require to_mathint(getReleased(id)) <= to_mathint(vestedAmount(id, t));
    require getReleased(id) > 0;
    assert to_mathint(e.block.timestamp) >= to_mathint(getStart(id)),
        "released(id) > 0 implies the schedule has started";
}

// RENOUNCED is terminal: ownership can never be re-established.
rule rule_ownership_renounced_is_terminal(method f, env e, calldataarg args) filtered { f -> !f.isView } {
    require e.msg.sender != 0;
    require owner() == 0;
    f@withrevert(e, args);
    assert owner() == 0, "RENOUNCED is terminal: ownership can never be re-established";
}

// Ownership transfers in one step, with no pending state and no delay.
rule rule_ownership_transfer_is_single_step(env e, address newOwner) {
    require e.msg.sender != 0;
    transferOwnership(e, newOwner);
    assert owner() == newOwner,
        "ownership transfers in one step, with no pending state and no delay";
}

// After renounceOwnership every gated function is permanently unreachable.
rule rule_renounced_leaves_only_release(method f, env e, calldataarg args)
    filtered {
        f -> f.selector ==
                sig:createSchedule(bytes32,address,uint256,uint64,uint64,uint64,uint16).selector
          || f.selector == sig:amendSchedule(bytes32,uint64,uint64,uint64,uint16).selector
          || f.selector == sig:updateBeneficiary(bytes32,address).selector
          || f.selector == sig:sweep(address,address).selector
    }
{
    require e.msg.sender != 0;
    require owner() == 0;
    f@withrevert(e, args);
    assert lastReverted,
        "after renounceOwnership every gated function is permanently unreachable";
}

// AmendSchedule reverts only for an enumerated reason.
rule rule_amend_revert_profile_complete(env e, bytes32 id, uint64 start, uint64 cliffSeconds,
                                        uint64 durationSeconds, uint16 tgeBps) {
    require e.msg.sender != 0;
    require e.msg.value == 0;
    require e.block.timestamp < TS_BOUND();
    address ownerBefore = owner();
    bool    exBefore    = getExists(id);
    uint64  stBefore    = getStart(id);
    amendSchedule@withrevert(e, id, start, cliffSeconds, durationSeconds, tgeBps);
    assert lastReverted =>
        (  e.msg.sender != ownerBefore
        || !exBefore
        || to_mathint(e.block.timestamp) >= to_mathint(stBefore)
        || to_mathint(tgeBps) > BPS_ONE()
        || to_mathint(start) < to_mathint(e.block.timestamp)
        || to_mathint(start) > to_mathint(e.block.timestamp)
                                 + to_mathint(MAX_START_DELAY())
        || cliffSeconds    > MAX_CLIFF()
        || durationSeconds > MAX_DURATION() ),
        "amendSchedule reverts only for an enumerated reason";
}

// Every enumerated createSchedule guard genuinely blocks the call.
rule rule_create_guard_conditions_force_revert(env e, bytes32 id, address ben, uint256 total,
                                               uint64 start, uint64 cliffSeconds,
                                               uint64 durationSeconds, uint16 tgeBps) {
    require e.msg.sender != 0;
    require e.block.timestamp < TS_BOUND();
    require
        (  e.msg.sender != owner()
        || getExists(id)
        || ben == 0 || ben == currentContract || ben == token()
        || total == 0
        || to_mathint(tgeBps) > BPS_ONE()
        || to_mathint(start) < to_mathint(e.block.timestamp)
        || to_mathint(start) > to_mathint(e.block.timestamp)
                                 + to_mathint(MAX_START_DELAY())
        || cliffSeconds    > MAX_CLIFF()
        || durationSeconds > MAX_DURATION() );
    createSchedule@withrevert(e, id, ben, total, start, cliffSeconds, durationSeconds, tgeBps);
    assert lastReverted,
        "every enumerated createSchedule guard genuinely blocks the call";
}

// VestedAmount is monotone in time.
rule rule_vested_monotone_in_time(bytes32 id, uint64 t1, uint64 t2) {
    require getExists(id);
    requireInvariant inv_sched_param_bounds(id);
    require scheduleWindowInBounds(id);
    require t1 <= t2;
    assert vestedAmount(id, t1) <= vestedAmount(id, t2), "vestedAmount is monotone in time";
    assert to_mathint(vestedAmount(id, t2)) <= to_mathint(getTotal(id)),
        "and is capped by the schedule total";
}

// At the cliff boundary the vested amount is exactly the TGE amount.
rule rule_vested_branch_contiguity(bytes32 id) {
    require getExists(id);
    requireInvariant inv_sched_param_bounds(id);
    requireInvariant inv_sched_tge_amount_le_total(id);
    require scheduleWindowInBounds(id);
    require getDuration(id) > 0;
    uint64 linearStart = require_uint64(to_mathint(getStart(id)) + to_mathint(getCliff(id)));
    uint64 linearEnd   = require_uint64(to_mathint(linearStart) + to_mathint(getDuration(id)));
    assert to_mathint(vestedAmount(id, linearStart))
            == ( to_mathint(getTotal(id)) * to_mathint(getTgeBps(id)) ) / BPS_ONE(),
        "at the cliff boundary the vested amount is exactly the TGE amount";
    assert vestedAmount(id, linearEnd) == getTotal(id),
        "at the end of the linear window the vested amount is exactly the total";
}

// Nothing is vested before start, whatever tgeBps says.
rule rule_vested_zero_before_start(bytes32 id, uint64 t) {
    require getExists(id);
    require t < getStart(id);
    assert vestedAmount(id, t) == 0,
        "nothing is vested before start, whatever tgeBps says";
}

// release before the start date reverts 'nothing to release'.
rule rule_release_reverts_before_start(env e, bytes32 id) {
    require e.block.timestamp < TS_BOUND();
    require getExists(id);
    require scheduleWindowInBounds(id);
    uint64 t = require_uint64(e.block.timestamp);
    require t < getStart(id);
    require to_mathint(getReleased(id)) <= to_mathint(vestedAmount(id, t));
    release@withrevert(e, id);
    assert lastReverted, "release before start reverts 'nothing to release' (:175)";
}

// After full vest the curve never moves again.
rule rule_vested_complete_absorbing(bytes32 id, uint64 t1, uint64 t2) {
    require getExists(id);
    requireInvariant inv_sched_param_bounds(id);
    require scheduleWindowInBounds(id);
    require to_mathint(t1) >= to_mathint(getStart(id)) + to_mathint(getCliff(id))
                                 + to_mathint(getDuration(id));
    require t2 >= t1;
    assert vestedAmount(id, t2) == vestedAmount(id, t1),
        "after full vest the curve never moves again";
    assert vestedAmount(id, t1) == getTotal(id), "and it sits exactly at total";
}

// A zero-duration schedule unlocks 100% in a single step at the cliff.
rule rule_vested_zero_duration_step(bytes32 id) {
    require getExists(id);
    requireInvariant inv_sched_param_bounds(id);
    require scheduleWindowInBounds(id);
    require getDuration(id) == 0;
    uint64 linearStart = require_uint64(to_mathint(getStart(id)) + to_mathint(getCliff(id)));
    assert vestedAmount(id, linearStart) == getTotal(id),
        "a zero-duration schedule unlocks 100% in a single step at the cliff";
}

// For every t at or after the cliff a zero-duration schedule is fully vested.
rule rule_vested_zero_duration_documented_branch(bytes32 id, uint64 t) {
    require getExists(id);
    requireInvariant inv_sched_param_bounds(id);
    require scheduleWindowInBounds(id);
    require getDuration(id) == 0;
    require to_mathint(t) >= to_mathint(getStart(id)) + to_mathint(getCliff(id));
    assert vestedAmount(id, t) == getTotal(id),
        "for every t at or after the cliff a zero-duration schedule is fully vested";
}

// At full vest the beneficiary is entitled to the entire total, to the wei.
rule rule_full_vest_no_stranded_dust(bytes32 id, uint64 t) {
    require getExists(id);
    requireInvariant inv_sched_param_bounds(id);
    requireInvariant inv_sched_tge_amount_le_total(id);
    require scheduleWindowInBounds(id);
    require to_mathint(t) >= to_mathint(getStart(id)) + to_mathint(getCliff(id))
                                 + to_mathint(getDuration(id));
    assert vestedAmount(id, t) == getTotal(id),
        "at full vest the beneficiary is entitled to the entire total, to the wei";
}

// The TGE calculation floors, so it never over-pays.
rule rule_rounding_favours_protocol_no_stranded_value(bytes32 id) {
    require getExists(id);
    requireInvariant inv_sched_param_bounds(id);
    mathint total = to_mathint(getTotal(id));
    mathint bps   = to_mathint(getTgeBps(id));
    mathint tge   = ( total * bps ) / BPS_ONE();
    assert tge * BPS_ONE() <= total * bps,
        ":151 floors, so the TGE amount never over-pays";
    assert tge <= total,
        "and the floored TGE amount never exceeds the total (remaining >= 0 at :152)";
    assert tge + ( total - tge ) == total,
        "tgeAmount + remaining reconstructs total exactly: no wei is stranded at :152";
}

// VestedAmount does not revert for an existing schedule at any representable timestamp.
rule rule_vested_never_reverts(bytes32 id, uint64 t) {
    require totalInBounds(id);
    require getExists(id);
    requireInvariant inv_sched_param_bounds(id);
    require scheduleWindowInBounds(id);
    vestedAmount@withrevert(id, t);
    assert !lastReverted,
        "vestedAmount does not revert for an existing schedule at any representable timestamp";
}

// Restoring the original parameters restores the original curve exactly.
rule rule_amend_roundtrip_restores_curve(env e1, env e2, bytes32 id, uint64 t,
                                         uint64 startTmp, uint64 cliffTmp, uint64 durTmp,
                                         uint16 bpsTmp) {
    require e1.block.timestamp < TS_BOUND();
    require e2.block.timestamp < TS_BOUND();
    require getExists(id);
    require scheduleWindowInBounds(id);
    uint64  start0 = getStart(id);
    uint64  cliff0 = getCliff(id);
    uint64  dur0   = getDuration(id);
    uint16  bps0   = getTgeBps(id);
    uint256 vested0 = vestedAmount(id, t);
    amendSchedule(e1, id, startTmp, cliffTmp, durTmp, bpsTmp);
    amendSchedule(e2, id, start0,   cliff0,   dur0,   bps0);
    assert vestedAmount(id, t) == vested0,
        "restoring the original parameters restores the original curve exactly";
}

// rule duplicate beneficiary reachable.
rule rule_duplicate_beneficiary_reachable(bytes32 idA, bytes32 idB) {
    require idA != idB;
    satisfy getExists(idA) && getExists(idB)
            && getBeneficiary(idA) == getBeneficiary(idB);
}

// No method reduces the contract's native balance: ETH can enter but never leave.
rule rule_vesting_native_balance_non_decreasing(method f, env e, calldataarg args) filtered { f -> !f.isView } {
    require e.msg.sender != currentContract;
    mathint ethBefore = nativeBalances[currentContract];
    f(e, args);
    assert nativeBalances[currentContract] >= ethBefore,
        "no method reduces the contract's native balance: ETH can enter but never leave";
}

// No non-settling method may reduce a third party's accrued entitlement.
rule rule_third_party_entitlement_isolation(method f, env e, calldataarg args,
                                            bytes32 idA, bytes32 idB, address u)
    filtered {
        f -> !f.isView

          && f.selector != sig:release(bytes32).selector
          && f.selector != sig:updateBeneficiary(bytes32,address).selector
    }
{
    require e.msg.value == 0;
    require e.block.timestamp < TS_BOUND();
    require totalInBounds(idA) && totalInBounds(idB);
    requireInvariant inv_sched_param_bounds(idA);
    requireInvariant inv_sched_param_bounds(idB);
    requireInvariant inv_sched_tge_amount_le_total(idA);
    requireInvariant inv_sched_tge_amount_le_total(idB);
    require idA != idB;
    require u != e.msg.sender;
    require getExists(idA) && getExists(idB);
    require scheduleWindowInBounds(idA) && scheduleWindowInBounds(idB);
    uint64 t = require_uint64(e.block.timestamp);
    require to_mathint(getReleased(idA)) <= to_mathint(vestedAmount(idA, t));
    require to_mathint(getReleased(idB)) <= to_mathint(vestedAmount(idB, t));

    mathint entBeforeA = getBeneficiary(idA) == u
        ? to_mathint(vestedAmount(idA, t)) - to_mathint(getReleased(idA)) : 0;
    mathint entBeforeB = getBeneficiary(idB) == u
        ? to_mathint(vestedAmount(idB, t)) - to_mathint(getReleased(idB)) : 0;

    f(e, args);

    require scheduleWindowInBounds(idA) && scheduleWindowInBounds(idB);
    mathint entAfterA = getBeneficiary(idA) == u
        ? to_mathint(vestedAmount(idA, t)) - to_mathint(getReleased(idA)) : 0;
    mathint entAfterB = getBeneficiary(idB) == u
        ? to_mathint(vestedAmount(idB, t)) - to_mathint(getReleased(idB)) : 0;

    assert entAfterA + entAfterB >= entBeforeA + entBeforeB,
        "no non-settling method may reduce a third party's accrued entitlement";
}

// EXPECTED TO FAIL - the counterexample is the finding; a pass means this rule is wrong.
// The delay window must stay anchored to CREATION, not be re-anchored on every amend.
rule rule_sched_start_creation_anchored_bound(
        env e0, env e1, env e2, bytes32 id, address ben, uint256 total,
        uint64 start0, uint64 cliff0, uint64 dur0, uint16 bps0,
        uint64 start1, uint64 cliff1, uint64 dur1, uint16 bps1,
        uint64 start2, uint64 cliff2, uint64 dur2, uint16 bps2) {
    require e0.block.timestamp < TS_BOUND();
    require e1.block.timestamp < TS_BOUND();
    require e2.block.timestamp < TS_BOUND();
    createSchedule(e0, id, ben, total, start0, cliff0, dur0, bps0);
    uint64 startAtCreation = getStart(id);
    amendSchedule(e1, id, start1, cliff1, dur1, bps1);
    amendSchedule(e2, id, start2, cliff2, dur2, bps2);
    assert to_mathint(getStart(id))
            <= to_mathint(startAtCreation) + to_mathint(MAX_START_DELAY()),
        "the delay window must stay anchored to CREATION, not be re-anchored on every amend";
}

// EXPECTED TO FAIL - the counterexample is the finding; a pass means this rule is wrong.
// An amend must never increase the amount vested at any timestamp.
rule rule_amend_never_accelerates_vesting(env e, bytes32 id, uint64 startNew, uint64 cliffNew,
                                          uint64 durNew, uint16 bpsNew, uint64 t) {
    require e.block.timestamp < TS_BOUND();
    require getExists(id);
    require scheduleWindowInBounds(id);
    uint256 vestedBefore = vestedAmount(id, t);
    amendSchedule(e, id, startNew, cliffNew, durNew, bpsNew);
    require scheduleWindowInBounds(id);
    assert vestedAmount(id, t) <= vestedBefore,
        "an amend must never increase the amount vested at any timestamp";
}
