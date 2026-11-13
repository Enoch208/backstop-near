use near_sdk::json_types::U128;

use super::harness::*;
use crate::{TaskState, VerdictOutcome, ERR_INVALID_STATE, ERR_STALE_ATTEMPT, ERR_VERDICT_EXISTS};

fn record(h: &mut Harness, attempt: u32, outcome: VerdictOutcome) {
    h.vault.record_verdict(
        "task-1".to_string(),
        attempt,
        hash(10),
        hash(11),
        hash(12),
        outcome,
    );
}

#[test]
fn tc004_stale_attempt_verdict_rejected() {
    let mut h = Harness::new();
    h.fund_demo("task-1", milli(250));
    h.assign("task-1", 1, &[(agent("a"), milli(300))]);
    h.open_recovery("task-1", "LEASE_EXPIRED");
    let abandoned = h.task("task-1");
    h.act(&verifier(), 0);
    expect_error(ERR_STALE_ATTEMPT, || {
        record(&mut h, 1, VerdictOutcome::Accept)
    });
    assert_eq!(h.task("task-1"), abandoned);

    h.assign("task-1", 2, &[(agent("b"), milli(300))]);
    let live = h.task("task-1");
    for stale in [0, 1, 3] {
        h.act(&verifier(), 0);
        expect_error(ERR_STALE_ATTEMPT, || {
            record(&mut h, stale, VerdictOutcome::Accept)
        });
    }
    assert_eq!(h.task("task-1"), live);
    h.assert_invariants("task-1");

    h.verdict("task-1", 2, VerdictOutcome::Accept);
    assert_eq!(h.task("task-1").state, TaskState::Accepted);
}

#[test]
fn tc005_rejected_verdict_cannot_settle_success() {
    let mut h = Harness::new();
    let policy = h.policy(2, milli(100));
    h.create_with_policy("task-1", milli(400), policy);
    h.assign("task-1", 1, &[(agent("a"), milli(300))]);
    h.verdict("task-1", 1, VerdictOutcome::Reject);
    assert_eq!(h.task("task-1").state, TaskState::RecoveryOpen);
    h.act(&verifier(), 0);
    expect_error(ERR_VERDICT_EXISTS, || {
        record(&mut h, 1, VerdictOutcome::Accept)
    });
    h.act(&coordinator(), 0);
    expect_error(ERR_INVALID_STATE, || {
        h.vault.finalize_success("task-1".to_string())
    });

    h.assign("task-1", 2, &[(agent("b"), milli(300))]);
    h.verdict("task-1", 2, VerdictOutcome::Reject);
    let task = h.task("task-1");
    assert_eq!(task.state, TaskState::TerminalFailure);
    assert_eq!(event_names(), vec!["verdict_recorded", "terminal_failure"]);
    h.act(&coordinator(), 0);
    expect_error(ERR_INVALID_STATE, || {
        h.vault.finalize_success("task-1".to_string())
    });
    assert!(h.task("task-1").transfer_ids.is_empty());
    assert_eq!(h.task("task-1"), task);
    h.assert_invariants("task-1");
}

#[test]
fn assignment_requires_the_next_attempt_number() {
    let mut h = Harness::new();
    h.fund_demo("task-1", milli(250));
    for attempt in [0, 2] {
        h.act(&coordinator(), 0);
        expect_error(ERR_STALE_ATTEMPT, || {
            h.vault.register_assignment(
                "task-1".to_string(),
                attempt,
                agent("a"),
                hash(1),
                U128(milli(100)),
                payees(&[(agent("a"), milli(100))]),
            )
        });
    }
    h.assign("task-1", 1, &[(agent("a"), milli(100))]);
    h.act(&coordinator(), 0);
    expect_error(ERR_INVALID_STATE, || {
        h.vault.register_assignment(
            "task-1".to_string(),
            2,
            agent("b"),
            hash(2),
            U128(milli(100)),
            payees(&[(agent("b"), milli(100))]),
        )
    });
}

#[test]
fn exhausted_attempts_end_in_terminal_failure() {
    let mut h = Harness::new();
    let policy = h.policy(2, milli(100));
    h.create_with_policy("task-1", milli(400), policy);
    h.assign("task-1", 1, &[(agent("a"), milli(300))]);
    h.open_recovery("task-1", "LEASE_EXPIRED");
    assert_eq!(h.task("task-1").state, TaskState::RecoveryOpen);
    h.assign("task-1", 2, &[(agent("b"), milli(300))]);
    h.open_recovery("task-1", "LEASE_EXPIRED");
    assert_eq!(h.task("task-1").state, TaskState::TerminalFailure);
    assert_eq!(event_names(), vec!["terminal_failure"]);
    h.act(&coordinator(), 0);
    expect_error(ERR_INVALID_STATE, || {
        h.vault.register_assignment(
            "task-1".to_string(),
            3,
            agent("c"),
            hash(3),
            U128(milli(100)),
            payees(&[(agent("c"), milli(100))]),
        )
    });
}
