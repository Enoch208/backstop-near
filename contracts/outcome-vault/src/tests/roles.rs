use near_sdk::json_types::U128;

use super::harness::*;
use crate::{
    Roles, TaskState, VerdictOutcome, ERR_NOT_COORDINATOR, ERR_NOT_OWNER, ERR_NOT_VERIFIER,
    ERR_ROLE_CONFLICT,
};

#[test]
fn tc012_only_verifier_records_verdicts() {
    let mut h = Harness::new();
    h.fund_demo("task-1", milli(250));
    h.assign("task-1", 1, &[(agent("a"), milli(300))]);
    let before = h.task("task-1");
    for caller in [
        coordinator(),
        customer(),
        guarantor(),
        agent("a"),
        owner(),
        stranger(),
    ] {
        h.act(&caller, 0);
        expect_error(ERR_NOT_VERIFIER, || {
            h.vault.record_verdict(
                "task-1".to_string(),
                1,
                hash(10),
                hash(11),
                hash(12),
                VerdictOutcome::Accept,
            )
        });
    }
    assert_eq!(h.task("task-1"), before);
    h.verdict("task-1", 1, VerdictOutcome::Accept);
    let verdict = h.task("task-1").verdict.expect("verdict recorded");
    assert_eq!(verdict.signer, verifier());
    assert_eq!(verdict.attempt, 1);
}

#[test]
fn only_coordinator_assigns() {
    let mut h = Harness::new();
    h.fund_demo("task-1", milli(250));
    let before = h.task("task-1");
    for caller in [
        verifier(),
        customer(),
        guarantor(),
        agent("a"),
        owner(),
        stranger(),
    ] {
        h.act(&caller, 0);
        expect_error(ERR_NOT_COORDINATOR, || {
            h.vault.register_assignment(
                "task-1".to_string(),
                1,
                agent("a"),
                hash(1),
                U128(milli(300)),
                payees(&[(agent("a"), milli(300))]),
            )
        });
    }
    assert_eq!(h.task("task-1"), before);
    h.assign("task-1", 1, &[(agent("a"), milli(300))]);
    for caller in [verifier(), customer(), agent("a")] {
        h.act(&caller, 0);
        expect_error(ERR_NOT_COORDINATOR, || {
            h.vault
                .open_recovery("task-1".to_string(), "LEASE_EXPIRED".to_string())
        });
    }
    assert_eq!(h.task("task-1").state, TaskState::Assigned);
}

#[test]
fn only_owner_rotates_roles() {
    let mut h = Harness::new();
    let rotated = account("coordinator-2.near");
    h.act(&coordinator(), 0);
    expect_error(ERR_NOT_OWNER, || {
        h.vault.set_roles(coordinator(), coordinator())
    });
    h.act(&owner(), 0);
    expect_error(ERR_ROLE_CONFLICT, || {
        h.vault.set_roles(verifier(), verifier())
    });
    h.act(&owner(), 0);
    h.vault.set_roles(rotated.clone(), verifier());
    assert_eq!(
        h.vault.get_roles(),
        Roles {
            owner: owner(),
            coordinator: rotated.clone(),
            verifier: verifier(),
        }
    );
    assert_eq!(event_names(), vec!["roles_updated"]);

    h.fund_demo("task-1", milli(250));
    h.act(&coordinator(), 0);
    expect_error(ERR_NOT_COORDINATOR, || {
        h.vault.register_assignment(
            "task-1".to_string(),
            1,
            agent("a"),
            hash(1),
            U128(milli(300)),
            payees(&[(agent("a"), milli(300))]),
        )
    });
    h.act(&rotated, 0);
    h.vault.register_assignment(
        "task-1".to_string(),
        1,
        agent("a"),
        hash(1),
        U128(milli(300)),
        payees(&[(agent("a"), milli(300))]),
    );
    assert_eq!(h.task("task-1").state, TaskState::Assigned);
}
