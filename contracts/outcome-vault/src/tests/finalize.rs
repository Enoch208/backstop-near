use super::harness::*;
use crate::{
    Pool, TaskState, TransferStatus, VerdictOutcome, ERR_ALREADY_SETTLED, ERR_UNAUTHORIZED,
};

#[test]
fn tc008_double_finalize_pays_once() {
    let mut h = Harness::new();
    h.fund_demo("task-1", milli(250));
    h.assign("task-1", 1, &[(agent("a"), milli(300))]);
    h.verdict("task-1", 1, VerdictOutcome::Accept);
    h.finalize_success("task-1");
    let first = h.task("task-1");
    let first_ledger = h.ledger("task-1");

    h.act(&customer(), 0);
    expect_error(ERR_ALREADY_SETTLED, || {
        h.vault.finalize_success("task-1".to_string())
    });
    assert!(scheduled_payments().is_empty());
    h.act(&coordinator(), 0);
    expect_error(ERR_ALREADY_SETTLED, || {
        h.vault.finalize_success("task-1".to_string())
    });
    h.act(&coordinator(), 0);
    expect_error(ERR_ALREADY_SETTLED, || {
        h.vault.finalize_failure("task-1".to_string())
    });
    assert_eq!(h.task("task-1"), first);
    assert_eq!(h.ledger("task-1"), first_ledger);

    h.confirm_all("task-1");
    h.act(&coordinator(), 0);
    expect_error(ERR_ALREADY_SETTLED, || {
        h.vault.finalize_success("task-1".to_string())
    });
    let ledger = h.ledger("task-1");
    assert_eq!(ledger.confirmed_outflow, milli(690));
    assert_eq!(h.confirmed_to("task-1", &agent("a")), milli(300));
    assert!(h
        .transfers("task-1")
        .iter()
        .all(|transfer| transfer.status == TransferStatus::Confirmed && transfer.retries == 0));
}

#[test]
fn primary_success_without_guarantor_returns_premium_to_customer() {
    let mut h = Harness::new();
    h.create_task("task-1", milli(400));
    h.fund_premium("task-1", milli(40));
    h.assign("task-1", 1, &[(agent("a"), milli(400))]);
    h.verdict("task-1", 1, VerdictOutcome::Accept);
    h.finalize_success("task-1");
    assert_eq!(
        h.legs("task-1"),
        vec![
            (
                "task-1:1:0".to_string(),
                agent("a"),
                milli(400),
                Pool::Escrow
            ),
            (
                "task-1:1:1".to_string(),
                customer(),
                milli(40),
                Pool::Premium
            ),
        ]
    );
    h.confirm_all("task-1");
    assert_eq!(h.task("task-1").state, TaskState::Settled);
}

#[test]
fn only_coordinator_or_task_owner_finalizes() {
    let mut h = Harness::new();
    h.fund_demo("task-1", milli(250));
    h.assign("task-1", 1, &[(agent("a"), milli(300))]);
    h.verdict("task-1", 1, VerdictOutcome::Accept);
    for caller in [stranger(), verifier(), guarantor(), agent("a"), owner()] {
        h.act(&caller, 0);
        expect_error(ERR_UNAUTHORIZED, || {
            h.vault.finalize_success("task-1".to_string())
        });
    }
    h.act(&customer(), 0);
    h.vault.finalize_success("task-1".to_string());
    assert_eq!(h.task("task-1").state, TaskState::SettlementPending);
}
