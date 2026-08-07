methods {
    function totalSupply()                   external returns (uint256) envfree;
    function balanceOf(address)              external returns (uint256) envfree;
    function allowance(address, address)     external returns (uint256) envfree;
    function decimals()                      external returns (uint8)   envfree;
    function INITIAL_SUPPLY()                external returns (uint256) envfree;
    function transfer(address, uint256)               external returns (bool);
    function transferFrom(address, address, uint256)  external returns (bool);
    function approve(address, uint256)                external returns (bool);
    function burn(uint256)                            external;
    function burnFrom(address, uint256)               external;
}
ghost mathint g_sumOfBalances {
    init_state axiom g_sumOfBalances == 0;
}
ghost mathint g_burnedTotal {
    init_state axiom g_burnedTotal == 0;
}
ghost mathint g_mintCount {
    init_state axiom g_mintCount == 0;
}
hook Sstore _balances[KEY address a] uint256 newValue (uint256 oldValue) {
    g_sumOfBalances = g_sumOfBalances + to_mathint(newValue) - to_mathint(oldValue);
}
hook Sload uint256 val _balances[KEY address a] {
    require to_mathint(val) <= g_sumOfBalances;
}
hook Sstore _totalSupply uint256 newValue (uint256 oldValue) {
    if (newValue > oldValue) {
        g_mintCount = g_mintCount + 1;
    }
    if (newValue < oldValue) {
        g_burnedTotal = g_burnedTotal + to_mathint(oldValue) - to_mathint(newValue);
    }
}

// The sum of all balances always equals totalSupply().
invariant inv_token_supply_is_sum_of_balances()
    g_sumOfBalances == to_mathint(totalSupply());

// No single balance ever exceeds totalSupply().
invariant inv_token_balance_le_supply(address a)
    to_mathint(balanceOf(a)) <= to_mathint(totalSupply())
    {
        preserved {
            requireInvariant inv_token_supply_is_sum_of_balances();
        }
    }

// totalSupply() never exceeds INITIAL_SUPPLY: the token can only ever burn, never mint again.
invariant inv_token_supply_le_initial_supply()
    to_mathint(totalSupply()) <= to_mathint(INITIAL_SUPPLY())
    {
        preserved {
            requireInvariant inv_token_supply_is_sum_of_balances();
        }
    }

// Exactly one mint ever occurs, in the constructor. No post-deployment mint path exists.
invariant inv_token_mint_happens_exactly_once()
    g_mintCount == 1
    {
        preserved {
            requireInvariant inv_token_supply_is_sum_of_balances();
        }
    }

// INITIAL_SUPPLY always equals totalSupply() plus everything burned so far.
invariant inv_token_initial_supply_equals_supply_plus_burned()
    to_mathint(totalSupply()) + g_burnedTotal == to_mathint(INITIAL_SUPPLY())
    {
        preserved {
            requireInvariant inv_token_supply_is_sum_of_balances();
        }
    }

// A balance fell without the holder acting and without a sufficient pre-existing allowance.
rule rule_token_no_privileged_mover(method f, env e, calldataarg args, address a) filtered { f -> !f.isView } {
    requireInvariant inv_token_supply_is_sum_of_balances();
    requireInvariant inv_token_supply_is_sum_of_balances();
    requireInvariant inv_token_balance_le_supply(a);

    uint256 balBefore   = balanceOf(a);
    uint256 allowBefore = allowance(a, e.msg.sender);

    f(e, args);

    uint256 balAfter = balanceOf(a);

    assert balAfter < balBefore
        => ( e.msg.sender == a
          || to_mathint(allowBefore) >= to_mathint(balBefore) - to_mathint(balAfter) ),
        "a balance fell without the holder acting and without a sufficient pre-existing allowance";
}

// An allowance rose through a path other than approve() called by its own owner.
rule rule_token_allowance_rise_requires_approve_by_owner(
    method f, env e, calldataarg args, address o, address s
) filtered { f -> !f.isView } {
    uint256 allowPre = allowance(o, s);

    f(e, args);

    uint256 allowPost = allowance(o, s);

    assert allowPost > allowPre
        => ( f.selector == sig:approve(address,uint256).selector && e.msg.sender == o ),
        "an allowance rose through a path other than approve() called by its own owner";
}

// An infinite allowance was consumed by transferFrom.
rule rule_token_allowance_consumed_exactly_unless_max_transferFrom(
    env e, address o, address to, uint256 v
) {
    uint256 allowPre = allowance(o, e.msg.sender);

    transferFrom(e, o, to, v);

    uint256 allowPost = allowance(o, e.msg.sender);

    assert allowPre == max_uint256 => allowPost == allowPre,
        "an infinite allowance was consumed by transferFrom";
    assert allowPre != max_uint256
        => to_mathint(allowPost) == to_mathint(allowPre) - to_mathint(v),
        "a finite allowance was not reduced by exactly `value` on transferFrom";
}

// An infinite allowance was consumed by burnFrom.
rule rule_token_allowance_consumed_exactly_unless_max_burnFrom(env e, address acct, uint256 v) {
    requireInvariant inv_token_supply_is_sum_of_balances();
    uint256 allowPre = allowance(acct, e.msg.sender);

    burnFrom(e, acct, v);

    uint256 allowPost = allowance(acct, e.msg.sender);

    assert allowPre == max_uint256 => allowPost == allowPre,
        "an infinite allowance was consumed by burnFrom";
    assert allowPre != max_uint256
        => to_mathint(allowPost) == to_mathint(allowPre) - to_mathint(v),
        "a finite allowance was not reduced by exactly `value` on burnFrom";
}

// BurnFrom destroyed a third party's balance without a sufficient allowance.
rule rule_token_burnFrom_requires_allowance(env e, address acct, uint256 v) {
    requireInvariant inv_token_supply_is_sum_of_balances();
    require v > 0;

    uint256 allowPre = allowance(acct, e.msg.sender);

    burnFrom(e, acct, v);

    assert to_mathint(allowPre) >= to_mathint(v),
        "burnFrom destroyed a third party's balance without a sufficient allowance";
}

// TotalSupply() increased — a post-construction mint path exists.
rule rule_token_supply_monotone_non_increasing(method f, env e, calldataarg args) filtered { f -> !f.isView } {
    requireInvariant inv_token_supply_is_sum_of_balances();
    uint256 supplyPre = totalSupply();

    f(e, args);

    assert totalSupply() <= supplyPre,
        "totalSupply() increased — a post-construction mint path exists";
}

// TotalSupply() moved through a selector outside {burn, burnFrom}.
rule rule_token_supply_change_only_via_burn(method f, env e, calldataarg args) filtered { f -> !f.isView } {
    requireInvariant inv_token_supply_is_sum_of_balances();
    uint256 supplyPre = totalSupply();

    f(e, args);

    assert totalSupply() != supplyPre
        => ( f.selector == sig:burn(uint256).selector
          || f.selector == sig:burnFrom(address,uint256).selector ),
        "totalSupply() moved through a selector outside {burn, burnFrom}";
}

// Burn did not reduce totalSupply() by exactly `value`.
rule rule_token_burn_pairs_supply_with_balance(env e, uint256 v) {
    requireInvariant inv_token_supply_is_sum_of_balances();

    address holder    = e.msg.sender;
    uint256 supplyPre = totalSupply();
    uint256 balPre    = balanceOf(holder);

    burn(e, v);

    assert to_mathint(totalSupply()) == to_mathint(supplyPre) - to_mathint(v),
        "burn did not reduce totalSupply() by exactly `value`";
    assert to_mathint(balanceOf(holder)) == to_mathint(balPre) - to_mathint(v),
        "burn did not reduce the burner's balance by exactly `value`";
}

// BurnFrom did not reduce totalSupply() by exactly `value`.
rule rule_token_burnFrom_pairs_supply_with_balance(env e, address acct, uint256 v) {
    requireInvariant inv_token_supply_is_sum_of_balances();

    uint256 supplyPre = totalSupply();
    uint256 balPre    = balanceOf(acct);

    burnFrom(e, acct, v);

    assert to_mathint(totalSupply()) == to_mathint(supplyPre) - to_mathint(v),
        "burnFrom did not reduce totalSupply() by exactly `value`";
    assert to_mathint(balanceOf(acct)) == to_mathint(balPre) - to_mathint(v),
        "burnFrom did not reduce the account's balance by exactly `value`";
}

// INITIAL_SUPPLY() is not method-invariant — it is not a compile-time constant.
rule rule_token_initial_supply_constant(method f, env e, calldataarg args) filtered { f -> !f.isView } {
    requireInvariant inv_token_supply_is_sum_of_balances();
    uint256 constPre = INITIAL_SUPPLY();

    f(e, args);

    assert INITIAL_SUPPLY() == constPre,
        "INITIAL_SUPPLY() is not method-invariant — it is not a compile-time constant";
}

// Burning a positive amount left INITIAL_SUPPLY() and totalSupply() equal.
rule rule_token_burn_makes_supply_diverge(env e, uint256 v) {
    requireInvariant inv_token_supply_is_sum_of_balances();
    requireInvariant inv_token_initial_supply_equals_supply_plus_burned();

    require v > 0;
    require totalSupply() == INITIAL_SUPPLY();

    burn(e, v);

    assert totalSupply() < INITIAL_SUPPLY(),
        "burning a positive amount left INITIAL_SUPPLY() and totalSupply() equal";
}

// rule token burn makes supply diverge witness.
rule rule_token_burn_makes_supply_diverge_witness(env e, uint256 v) {
    requireInvariant inv_token_supply_is_sum_of_balances();
    require v > 0;
    require totalSupply() == INITIAL_SUPPLY();

    burn(e, v);

    satisfy totalSupply() < INITIAL_SUPPLY();
}

// Sender debited by other than exactly `value` — a fee, rebase or burn-on-transfer exists.
rule rule_token_transfer_exact_no_fee(env e, address to, uint256 v, address other) {
    requireInvariant inv_token_supply_is_sum_of_balances();
    requireInvariant inv_token_balance_le_supply(e.msg.sender);
    requireInvariant inv_token_balance_le_supply(to);

    address from = e.msg.sender;

    require from != to;

    require other != from && other != to;

    uint256 fromPre   = balanceOf(from);
    uint256 toPre     = balanceOf(to);
    uint256 otherPre  = balanceOf(other);
    uint256 supplyPre = totalSupply();

    transfer(e, to, v);

    assert to_mathint(balanceOf(from)) == to_mathint(fromPre) - to_mathint(v),
        "sender debited by other than exactly `value` — a fee, rebase or burn-on-transfer exists";
    assert to_mathint(balanceOf(to)) == to_mathint(toPre) + to_mathint(v),
        "recipient credited by other than exactly `value`";
    assert balanceOf(other) == otherPre,
        "an uninvolved third party's balance moved during a transfer";
    assert totalSupply() == supplyPre,
        "transfer changed totalSupply()";
}

// Round trip did not restore the sender's balance.
rule rule_token_transfer_round_trip_restores(env eA, env eB, address b, uint256 v) {
    requireInvariant inv_token_supply_is_sum_of_balances();

    address a = eA.msg.sender;

    require eB.msg.sender == b;
    require a != b;

    uint256 aPre      = balanceOf(a);
    uint256 bPre      = balanceOf(b);
    uint256 supplyPre = totalSupply();

    transfer(eA, b, v);
    transfer(eB, a, v);

    assert balanceOf(a) == aPre,       "round trip did not restore the sender's balance";
    assert balanceOf(b) == bPre,       "round trip did not restore the recipient's balance";
    assert totalSupply() == supplyPre, "round trip changed totalSupply()";
}

// Self-transfer moved the balance - OZ _update's debit-then-credit ordering did not net to zero.
rule rule_token_self_transfer_nets_to_zero(env e, uint256 v) {
    requireInvariant inv_token_supply_is_sum_of_balances();

    address a         = e.msg.sender;
    uint256 balPre    = balanceOf(a);
    uint256 supplyPre = totalSupply();

    transfer(e, a, v);

    assert balanceOf(a) == balPre,
        "self-transfer moved the balance — OZ _update's debit(:187)-then-credit(:199) ordering did not net to zero";
    assert totalSupply() == supplyPre,
        "self-transfer changed totalSupply()";
}

// Self-transferFrom moved the balance — _update did not net to zero on from == to.
rule rule_token_self_transferFrom_nets_to_zero(env e, address a, uint256 v) {
    requireInvariant inv_token_supply_is_sum_of_balances();

    uint256 balPre    = balanceOf(a);
    uint256 supplyPre = totalSupply();

    transferFrom(e, a, a, v);

    assert balanceOf(a) == balPre,
        "self-transferFrom moved the balance — _update did not net to zero on from == to";
    assert totalSupply() == supplyPre,
        "self-transferFrom changed totalSupply()";
}

// MODEL FIDELITY FAILURE: a positive self-transfer LOWERED the balance — the debit was applied without the
// compensating credit (the naive pre-state model). Fix the model, do not record a PASS.
rule rule_model_safetransfer_selftransfer_fidelity(env e, uint256 v) {
    requireInvariant inv_token_supply_is_sum_of_balances();

    address self = e.msg.sender;

    require v > 0;

    uint256 balPre = balanceOf(self);

    transfer(e, self, v);

    uint256 balPost = balanceOf(self);

    assert to_mathint(balPost) >= to_mathint(balPre),
        "MODEL FIDELITY FAILURE: a positive self-transfer LOWERED the balance — the debit was applied without the compensating credit (the naive pre-state model). Fix the model, do not record a PASS.";
    assert to_mathint(balPost) <= to_mathint(balPre),
        "MODEL FIDELITY FAILURE: a positive self-transfer RAISED the balance — the credit was applied without the compensating debit.";
}

// rule model safetransfer selftransfer fidelity witness.
rule rule_model_safetransfer_selftransfer_fidelity_witness(env e, uint256 v) {
    requireInvariant inv_token_supply_is_sum_of_balances();
    require v > 0;

    uint256 balPre = balanceOf(e.msg.sender);

    transfer(e, e.msg.sender, v);

    satisfy balanceOf(e.msg.sender) == balPre;
}

// A selector outside {transfer, transferFrom, approve, burn, burnFrom} mutated token state.
rule rule_token_no_privileged_role(
    method f, env e, calldataarg args, address a, address o, address s
) filtered { f -> !f.isView } {
    uint256 supplyPre = totalSupply();
    uint256 balPre    = balanceOf(a);
    uint256 allowPre  = allowance(o, s);

    f(e, args);

    assert ( totalSupply()   != supplyPre
          || balanceOf(a)    != balPre
          || allowance(o, s) != allowPre )
        => ( f.selector == sig:transfer(address,uint256).selector
          || f.selector == sig:transferFrom(address,address,uint256).selector
          || f.selector == sig:approve(address,uint256).selector
          || f.selector == sig:burn(uint256).selector
          || f.selector == sig:burnFrom(address,uint256).selector ),
        "a selector outside {transfer, transferFrom, approve, burn, burnFrom} mutated token state";
}

// Approve() reverted for a reason other than the two documented zero-address guards — a caller-identity
// (privilege) gate exists.
rule rule_token_approve_has_no_sender_gate(env e, address s, uint256 v) {
    requireInvariant inv_token_supply_is_sum_of_balances();
    require e.msg.value == 0;

    approve@withrevert(e, s, v);

    assert lastReverted <=> (e.msg.sender == 0 || s == 0),
        "approve() reverted for a reason other than the two documented zero-address guards — a caller-identity (privilege) gate exists";
}

// Burn() reverted for a reason other than the zero-address sentinel or the caller's own insufficient balance
// — a caller-identity (privilege) gate exists.
rule rule_token_burn_has_no_sender_gate(env e, uint256 v) {
    requireInvariant inv_token_supply_is_sum_of_balances();

    require e.msg.value == 0;

    uint256 balPre = balanceOf(e.msg.sender);

    burn@withrevert(e, v);

    assert lastReverted <=> (e.msg.sender == 0 || balPre < v),
        "burn() reverted for a reason other than the zero-address sentinel or the caller's own insufficient balance — a caller-identity (privilege) gate exists";
}

// decimals() changed across a call - the OZ literal return has been overridden.
rule rule_token_metadata_immutable(method f, env e, calldataarg args) filtered { f -> !f.isView } {
    uint8 decPre = decimals();

    f(e, args);

    assert decimals() == decPre,
        "decimals() changed across a call — the OZ literal return at OZ/ERC20.sol:77 has been overridden";
}
