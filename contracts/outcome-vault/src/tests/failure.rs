use super::harness::*;
use crate::{
    Hash32, Pool, TaskState, VerdictOutcome, ERR_DEADLINE_NOT_REACHED, ERR_DEADLINE_PASSED,
    ERR_INVALID_STATE,
};
use near_sdk::json_types::U128;

#[test]
fn tc010_terminal_failure_refunds_and_compensates_within_liability() {
    let mut h = Harness::new();
    let policy = h.policy(1, milli(300));
    h.create_with_policy("task-1", milli(400), policy);
    h.fund_premium("task-1", milli(40));
    h.post_guarantee("task-1", milli(250), milli(200));
    h.assign("task-1", 1, &[(agent("a"), milli(300))]);
    h.verdict("task-1", 1, VerdictOutcome::Reject);
    assert_eq!(h.task("task-1").state, TaskState::TerminalFailure);
    h.assert_invariants("task-1");

    h.finalize_failure("task-1");
    h.assert_invariants("task-1");
    assert_eq!(
        h.legs("task-1"),
        vec![
            (
                "task-1:f:0".to_string(),
                customer(),
                milli(400),
                Pool::Escrow
            ),
            ("task-1:f:1".to_string(), customer(), milli(200), Pool::Bond),
            (
                "task-1:f:2".to_string(),
                customer(),
                milli(40),
                Pool::Premium
            ),
            ("task-1:f:3".to_string(), guarantor(), milli(50), Pool::Bond),
        ]
    );
    assert_eq!(h.task("task-1").state, TaskState::FailureSettlementPending);
    assert_eq!(
        h.task("task-1").settlement_key,
        Some(Hash32::of("task-1:f"))
    );

    h.confirm_all("task-1");
    let ledger = h.ledger("task-1");
    assert_eq!(ledger.state, TaskState::FailureSettled);
    assert_eq!(ledger.bond_consumed, milli(200));
    assert!(ledger.bond_consumed <= ledger.max_bond_liability);
    assert_eq!(h.confirmed_to("task-1", &customer()), milli(640));
    assert_eq!(h.confirmed_to("task-1", &guarantor()), milli(50));
    assert_eq!(h.confirmed_to("task-1", &agent("a")), 0);
    assert_eq!(ledger.confirmed_outflow, ledger.total_inflow);
}

#[test]
fn failure_compensation_is_capped_by_policy() {
    let mut h = Harness::new();
    let policy = h.policy(1, milli(30));
    h.create_with_policy("task-1", milli(400), policy);
    h.post_guarantee("task-1", milli(250), milli(250));
    h.assign("task-1", 1, &[(agent("a"), milli(300))]);
    h.open_recovery("task-1", "AGENT_CRASHED");
    h.finalize_failure("task-1");
    assert_eq!(
        h.legs("task-1"),
        vec![
            (
                "task-1:f:0".to_string(),
                customer(),
                milli(400),
                Pool::Escrow
            ),
            ("task-1:f:1".to_string(), customer(), milli(30), Pool::Bond),
            (
                "task-1:f:2".to_string(),
                guarantor(),
                milli(220),
                Pool::Bond
            ),
        ]
    );
    h.confirm_all("task-1");
    assert_eq!(h.ledger("task-1").bond_consumed, milli(30));
}

#[test]
fn failure_settlement_waits_for_deadline() {
    let mut h = Harness::new();
    h.fund_demo("task-1", milli(250));
    h.assign("task-1", 1, &[(agent("a"), milli(300))]);
    h.open_recovery("task-1", "LEASE_EXPIRED");
    let open = h.task("task-1");
    h.act(&customer(), 0);
    expect_error(ERR_DEADLINE_NOT_REACHED, || {
        h.vault.finalize_failure("task-1".to_string())
    });
    assert_eq!(h.task("task-1"), open);

    h.now += 2 * HOUR_NS;
    h.act(&coordinator(), 0);
    expect_error(ERR_DEADLINE_PASSED, || {
        h.vault.register_assignment(
            "task-1".to_string(),
            2,
            agent("b"),
            hash(2),
            U128(milli(100)),
            payees(&[(agent("b"), milli(100))]),
        )
    });
    h.act(&customer(), 0);
    h.vault.finalize_failure("task-1".to_string());
    assert_eq!(h.task("task-1").state, TaskState::FailureSettlementPending);
    h.confirm_all("task-1");
    assert_eq!(h.confirmed_to("task-1", &customer()), milli(400 + 40 + 100));
    assert_eq!(h.confirmed_to("task-1", &guarantor()), milli(150));
}

#[test]
fn expired_assignment_can_fail_but_accepted_task_cannot() {
    let mut h = Harness::new();
    h.fund_demo("expired", milli(250));
    h.assign("expired", 1, &[(agent("a"), milli(300))]);
    h.fund_demo("accepted", milli(250));
    h.assign("accepted", 1, &[(agent("a"), milli(300))]);
    h.verdict("accepted", 1, VerdictOutcome::Accept);
    h.now += 2 * HOUR_NS;

    h.finalize_failure("expired");
    assert_eq!(h.task("expired").state, TaskState::FailureSettlementPending);

    h.act(&coordinator(), 0);
    expect_error(ERR_INVALID_STATE, || {
        h.vault.finalize_failure("accepted".to_string())
    });
    h.finalize_success("accepted");
    assert_eq!(h.task("accepted").state, TaskState::SettlementPending);
}

#[test]
fn open_recovery_after_deadline_is_terminal() {
    let mut h = Harness::new();
    h.fund_demo("task-1", milli(250));
    h.assign("task-1", 1, &[(agent("a"), milli(300))]);
    h.now += 2 * HOUR_NS;
    h.open_recovery("task-1", "LEASE_EXPIRED");
    assert_eq!(h.task("task-1").state, TaskState::TerminalFailure);
    let event = &events()[0];
    assert_eq!(event["event"], "terminal_failure");
    assert_eq!(event["data"][0]["reason"], "LEASE_EXPIRED");
    assert_eq!(event["data"][0]["epoch"], 1);
}

#[test]
fn an_outside_keeper_can_exit_an_expired_assignment_without_the_coordinator() {
    let mut h = Harness::new();
    h.fund_demo("task-1", milli(250));
    h.assign("task-1", 1, &[(agent("a"), milli(300))]);
    h.now += 2 * HOUR_NS;
    h.act(&verifier(), 0);
    expect_error(ERR_DEADLINE_PASSED, || {
        h.vault.record_verdict(
            "task-1".to_string(),
            1,
            hash(10),
            hash(11),
            hash(12),
            VerdictOutcome::Accept,
        )
    });
    h.act(&stranger(), 0);
    h.vault.finalize_failure("task-1".to_string());
    h.confirm_all("task-1");
    assert_eq!(h.ledger("task-1").state, TaskState::FailureSettled);
    assert_eq!(h.confirmed_to("task-1", &customer()), milli(540));
    assert_eq!(h.confirmed_to("task-1", &guarantor()), milli(150));
    assert_eq!(h.confirmed_to("task-1", &stranger()), 0);
}
