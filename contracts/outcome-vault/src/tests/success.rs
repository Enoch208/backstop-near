use super::harness::*;
use crate::settlement::settlement_key;
use crate::{Hash32, Pool, TaskState, VerdictOutcome};

#[test]
fn tc002_primary_success_pays_primary_and_refunds() {
    let mut h = Harness::new();
    h.fund_demo("task-1", milli(250));
    h.assign("task-1", 1, &[(agent("a"), milli(300))]);
    h.assert_invariants("task-1");
    h.verdict("task-1", 1, VerdictOutcome::Accept);
    h.assert_invariants("task-1");
    h.finalize_success("task-1");
    h.assert_invariants("task-1");

    assert_eq!(
        scheduled_payments(),
        vec![
            (agent("a"), milli(300)),
            (customer(), milli(100)),
            (guarantor(), milli(40)),
            (guarantor(), milli(250)),
        ]
    );
    assert_eq!(
        h.legs("task-1"),
        vec![
            (
                "task-1:1:0".to_string(),
                agent("a"),
                milli(300),
                Pool::Escrow
            ),
            (
                "task-1:1:1".to_string(),
                customer(),
                milli(100),
                Pool::Escrow
            ),
            (
                "task-1:1:2".to_string(),
                guarantor(),
                milli(40),
                Pool::Premium
            ),
            (
                "task-1:1:3".to_string(),
                guarantor(),
                milli(250),
                Pool::Bond
            ),
        ]
    );
    let pending = h.ledger("task-1");
    assert_eq!(pending.state, TaskState::SettlementPending);
    assert_eq!(pending.pending_outflow, milli(690));
    assert_eq!(
        pending.escrow_available + pending.premium_available + pending.bond_available,
        0
    );

    h.confirm_all("task-1");
    let ledger = h.ledger("task-1");
    assert_eq!(ledger.state, TaskState::Settled);
    assert_eq!(ledger.confirmed_outflow, milli(690));
    assert_eq!(ledger.bond_consumed, 0);
    assert_eq!(h.confirmed_to("task-1", &agent("a")), milli(300));
    assert_eq!(h.confirmed_to("task-1", &customer()), milli(100));
    assert_eq!(h.confirmed_to("task-1", &guarantor()), milli(290));
}

#[test]
fn canonical_demo_ledger_reconciles() {
    let mut h = Harness::new();
    h.fund_demo("demo", milli(250));
    h.assert_invariants("demo");

    h.assign("demo", 1, &[(agent("a"), milli(300))]);
    h.assert_invariants("demo");
    h.open_recovery("demo", "LEASE_EXPIRED");
    h.assert_invariants("demo");
    assert_eq!(h.task("demo").state, TaskState::RecoveryOpen);
    assert_eq!(event_names(), vec!["recovery_opened"]);

    h.assign("demo", 2, &[(agent("b"), milli(350))]);
    h.assert_invariants("demo");
    h.verdict("demo", 2, VerdictOutcome::Reject);
    h.assert_invariants("demo");
    assert_eq!(h.task("demo").state, TaskState::RecoveryOpen);
    assert_eq!(event_names(), vec!["verdict_recorded", "recovery_opened"]);

    h.assign(
        "demo",
        3,
        &[(agent("c"), milli(400)), (agent("d"), milli(120))],
    );
    h.assert_invariants("demo");
    h.verdict("demo", 3, VerdictOutcome::Accept);
    h.assert_invariants("demo");
    h.finalize_success("demo");
    h.assert_invariants("demo");

    assert_eq!(
        h.legs("demo"),
        vec![
            ("demo:3:0".to_string(), agent("c"), milli(400), Pool::Escrow),
            ("demo:3:1".to_string(), agent("d"), milli(120), Pool::Bond),
            ("demo:3:2".to_string(), customer(), milli(40), Pool::Premium),
            ("demo:3:3".to_string(), guarantor(), milli(130), Pool::Bond),
        ]
    );
    assert_eq!(h.ledger("demo").bond_consumed, milli(120));

    h.confirm_all("demo");
    let ledger = h.ledger("demo");
    let task = h.task("demo");
    assert_eq!(ledger.state, TaskState::Settled);
    assert_eq!(ledger.total_inflow, milli(690));
    assert_eq!(ledger.confirmed_outflow, milli(690));
    assert_eq!(ledger.outflow_escrow, milli(400));
    assert_eq!(ledger.outflow_premium, milli(40));
    assert_eq!(ledger.outflow_bond, milli(250));
    assert_eq!(ledger.bond_consumed, milli(120));
    assert!(ledger.bond_consumed <= ledger.max_bond_liability);
    assert_eq!(
        h.confirmed_to("demo", &agent("c")) + h.confirmed_to("demo", &agent("d")),
        milli(520)
    );
    assert_eq!(h.confirmed_to("demo", &guarantor()), milli(130));
    assert_eq!(h.confirmed_to("demo", &customer()), milli(40));
    assert_eq!(task.settlement_key, Some(Hash32::of("demo:3")));
    assert_eq!(task.ledger_hash, Some(Hash32::of(ledger.canonical_json())));

    let settled = events()
        .into_iter()
        .find(|event| event["event"] == "task_settled")
        .expect("task_settled emitted");
    let data = &settled["data"][0];
    assert_eq!(data["settlement_key"], hex(&settlement_key("demo", "3")));
    assert_eq!(
        data["ledger_hash"],
        hex(&Hash32::of(ledger.canonical_json()))
    );
    assert_eq!(data["state"], "SETTLED");
}

fn hex(hash: &Hash32) -> String {
    hash.0.iter().map(|byte| format!("{byte:02x}")).collect()
}
