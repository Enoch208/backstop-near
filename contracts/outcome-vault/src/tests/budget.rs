use near_sdk::json_types::U128;
use near_sdk::AccountId;

use super::harness::*;
use crate::{
    VerdictOutcome, ERR_BUDGET_EXCEEDED, ERR_DUPLICATE_PAYEE, ERR_EMPTY_PAYEES,
    ERR_PAYEE_SUM_MISMATCH, ERR_TOO_MANY_PAYEES, ERR_ZERO_PAYEE_AMOUNT,
};

type PayeeCase = (&'static str, u128, Vec<(AccountId, u128)>);

#[test]
fn tc013_assignment_beyond_liability_rejected_and_ledger_unchanged() {
    let mut h = Harness::new();
    h.fund_demo("task-1", milli(100));
    let task = h.task("task-1");
    let ledger = h.ledger("task-1");
    h.act(&coordinator(), 0);
    expect_error(ERR_BUDGET_EXCEEDED, || {
        h.vault.register_assignment(
            "task-1".to_string(),
            1,
            agent("a"),
            hash(1),
            U128(milli(500) + 1),
            payees(&[(agent("a"), milli(400)), (agent("b"), milli(100) + 1)]),
        )
    });
    assert_eq!(h.task("task-1"), task);
    assert_eq!(h.ledger("task-1"), ledger);
    assert!(scheduled_payments().is_empty());

    h.assign(
        "task-1",
        1,
        &[(agent("a"), milli(400)), (agent("b"), milli(100))],
    );
    h.verdict("task-1", 1, VerdictOutcome::Accept);
    h.finalize_success("task-1");
    h.confirm_all("task-1");
    let settled = h.ledger("task-1");
    assert_eq!(settled.bond_consumed, milli(100));
    assert_eq!(settled.bond_consumed, settled.max_bond_liability);
    assert_eq!(
        h.confirmed_to("task-1", &guarantor()),
        milli(150) + milli(40)
    );
}

#[test]
fn payee_list_must_be_exact() {
    let mut h = Harness::new();
    h.fund_demo("task-1", milli(250));
    let cases: Vec<PayeeCase> = vec![
        (ERR_EMPTY_PAYEES, milli(100), vec![]),
        (
            ERR_DUPLICATE_PAYEE,
            milli(100),
            vec![(agent("a"), milli(50)), (agent("a"), milli(50))],
        ),
        (
            ERR_ZERO_PAYEE_AMOUNT,
            milli(100),
            vec![(agent("a"), milli(100)), (agent("b"), 0)],
        ),
        (
            ERR_PAYEE_SUM_MISMATCH,
            milli(100),
            vec![(agent("a"), milli(60)), (agent("b"), milli(30))],
        ),
        (
            ERR_TOO_MANY_PAYEES,
            milli(70),
            (0..7)
                .map(|index| (agent(&index.to_string()), milli(10)))
                .collect(),
        ),
    ];
    let before = h.task("task-1");
    for (code, amount, entries) in cases {
        h.act(&coordinator(), 0);
        expect_error(code, || {
            h.vault.register_assignment(
                "task-1".to_string(),
                1,
                agent("a"),
                hash(1),
                U128(amount),
                payees(&entries),
            )
        });
    }
    assert_eq!(h.task("task-1"), before);
}

#[test]
fn a_guarantee_deposit_cannot_be_reused_by_another_task() {
    let mut h = Harness::new();
    h.fund_demo("funded", milli(250));
    h.create_task("unbonded", milli(400));
    h.act(&coordinator(), 0);
    expect_error(ERR_BUDGET_EXCEEDED, || {
        h.vault.register_assignment(
            "unbonded".to_string(),
            1,
            agent("a"),
            hash(1),
            U128(milli(401)),
            payees(&[(agent("a"), milli(401))]),
        )
    });
    assert_eq!(h.task("funded").bond_available, milli(250));
    assert_eq!(h.task("unbonded").bond_available, 0);
    h.assert_invariants("funded");
    h.assert_invariants("unbonded");
}

#[test]
fn funding_and_control_roles_cannot_collect_worker_pay() {
    let mut h = Harness::new();
    h.fund_demo("task-1", milli(250));
    let before = h.ledger("task-1");
    for conflicted in [
        customer(),
        guarantor(),
        verifier(),
        coordinator(),
        vault_account(),
    ] {
        h.act(&coordinator(), 0);
        expect_error(crate::ERR_CONFLICTED_PAYEE, || {
            h.vault.register_assignment(
                "task-1".to_string(),
                1,
                agent("a"),
                hash(1),
                U128(milli(100)),
                payees(&[(agent("a"), milli(60)), (conflicted, milli(40))]),
            )
        });
    }
    h.act(&coordinator(), 0);
    expect_error(crate::ERR_LEAD_NOT_PAYEE, || {
        h.vault.register_assignment(
            "task-1".to_string(),
            1,
            agent("a"),
            hash(1),
            U128(milli(100)),
            payees(&[(agent("b"), milli(100))]),
        )
    });
    assert_eq!(h.ledger("task-1"), before);
}
