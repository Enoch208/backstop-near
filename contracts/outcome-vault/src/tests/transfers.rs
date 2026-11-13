use super::harness::*;
use crate::{
    TaskState, TransferStatus, VerdictOutcome, ERR_RETRY_LIMIT, ERR_TRANSFER_NOT_FAILED,
    ERR_UNKNOWN_TRANSFER, MAX_TRANSFER_RETRIES,
};

fn settle_primary(h: &mut Harness) {
    h.fund_demo("task-1", milli(250));
    h.assign("task-1", 1, &[(agent("a"), milli(300))]);
    h.verdict("task-1", 1, VerdictOutcome::Accept);
    h.finalize_success("task-1");
}

#[test]
fn tc009_failed_transfer_retries_to_confirmed_once() {
    let mut h = Harness::new();
    settle_primary(&mut h);
    let payout = "task-1:1:0";

    h.complete(payout, false);
    h.assert_invariants("task-1");
    assert_eq!(h.transfer(payout).status, TransferStatus::Failed);
    assert_eq!(event_names(), vec!["transfer_failed"]);
    assert_eq!(h.ledger("task-1").failed_outflow, milli(300));

    h.retry(payout);
    h.assert_invariants("task-1");
    assert_eq!(scheduled_payments(), vec![(agent("a"), milli(300))]);
    let retried = h.transfer(payout);
    assert_eq!(retried.status, TransferStatus::Pending);
    assert_eq!(retried.retries, 1);
    assert_eq!(retried.recipient, agent("a"));
    assert_eq!(retried.amount, milli(300));

    let version = h.task("task-1").state_version;
    h.deliver(payout, 0, true);
    assert_eq!(h.transfer(payout).status, TransferStatus::Pending);
    assert_eq!(h.task("task-1").state_version, version);
    assert!(event_names().is_empty());

    h.complete(payout, true);
    h.assert_invariants("task-1");
    assert_eq!(h.transfer(payout).status, TransferStatus::Confirmed);
    let confirmed = h.transfer(payout);
    let version = h.task("task-1").state_version;

    h.deliver(payout, 1, true);
    h.deliver(payout, 1, false);
    h.deliver(payout, 0, false);
    assert_eq!(h.transfer(payout), confirmed);
    assert_eq!(h.task("task-1").state_version, version);
    h.act(&stranger(), 0);
    expect_error(ERR_TRANSFER_NOT_FAILED, || {
        h.vault.retry_failed_transfer(payout.to_string())
    });
    assert!(scheduled_payments().is_empty());

    h.confirm_all("task-1");
    let ledger = h.ledger("task-1");
    assert_eq!(ledger.state, TaskState::Settled);
    assert_eq!(h.confirmed_to("task-1", &agent("a")), milli(300));
    assert_eq!(ledger.confirmed_outflow, ledger.total_inflow);
}

#[test]
fn retry_cap_enforced() {
    let mut h = Harness::new();
    settle_primary(&mut h);
    let payout = "task-1:1:0";
    h.complete(payout, false);
    for attempt in 1..=MAX_TRANSFER_RETRIES {
        h.retry(payout);
        assert_eq!(h.transfer(payout).retries, attempt);
        h.complete(payout, false);
        h.assert_invariants("task-1");
    }
    let exhausted = h.transfer(payout);
    h.act(&stranger(), 0);
    expect_error(ERR_RETRY_LIMIT, || {
        h.vault.retry_failed_transfer(payout.to_string())
    });
    assert_eq!(h.transfer(payout), exhausted);
    assert_eq!(exhausted.status, TransferStatus::Failed);

    h.confirm_all("task-1");
    let ledger = h.ledger("task-1");
    assert_eq!(ledger.state, TaskState::SettlementPending);
    assert_eq!(ledger.failed_outflow, milli(300));
    assert_eq!(ledger.confirmed_outflow, milli(390));
    assert!(ledger.is_conserved());
}

#[test]
fn settlement_waits_for_every_transfer() {
    let mut h = Harness::new();
    settle_primary(&mut h);
    let ids = h.task("task-1").transfer_ids;
    for id in &ids[..ids.len() - 1] {
        h.complete(id, true);
        assert_eq!(h.task("task-1").state, TaskState::SettlementPending);
        assert!(h.task("task-1").ledger_hash.is_none());
    }
    h.complete(&ids[ids.len() - 1], true);
    let task = h.task("task-1");
    assert_eq!(task.state, TaskState::Settled);
    assert_eq!(event_names(), vec!["transfer_confirmed", "task_settled"]);
    assert_eq!(
        task.ledger_hash,
        Some(crate::Hash32::of(h.ledger("task-1").canonical_json()))
    );
}

#[test]
fn unknown_transfer_cannot_be_retried() {
    let mut h = Harness::new();
    settle_primary(&mut h);
    h.act(&stranger(), 0);
    expect_error(ERR_UNKNOWN_TRANSFER, || {
        h.vault.retry_failed_transfer("task-1:1:9".to_string())
    });
}
