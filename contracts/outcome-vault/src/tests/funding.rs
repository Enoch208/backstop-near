use near_sdk::json_types::U128;

use super::harness::*;
use crate::funding::MIN_ESCROW;
use crate::{
    TaskState, VerdictOutcome, ERR_DUST_ESCROW, ERR_FUNDING_CLOSED, ERR_GUARANTOR_EXISTS,
    ERR_INVALID_TASK_ID, ERR_LIABILITY_BELOW_MIN, ERR_LIABILITY_EXCEEDS_BOND, ERR_NOT_TASK_OWNER,
    ERR_SELF_GUARANTEE, ERR_TASK_EXISTS,
};

#[test]
fn tc001_funding_credits_three_separate_pools() {
    let mut h = Harness::new();
    h.create_task("task-1", milli(400));
    h.assert_invariants("task-1");
    h.fund_premium("task-1", milli(40));
    h.assert_invariants("task-1");
    h.post_guarantee("task-1", milli(250), milli(200));
    h.assert_invariants("task-1");
    h.act(&customer(), milli(25));
    h.vault.fund_task("task-1".to_string());
    h.assert_invariants("task-1");

    let ledger = h.ledger("task-1");
    assert_eq!(ledger.escrow_available, milli(425));
    assert_eq!(ledger.premium_available, milli(40));
    assert_eq!(ledger.bond_available, milli(250));
    assert_eq!(ledger.max_bond_liability, milli(200));
    assert_eq!(ledger.inflow_escrow, milli(425));
    assert_eq!(ledger.inflow_premium, milli(40));
    assert_eq!(ledger.inflow_bond, milli(250));
    assert_eq!(ledger.total_inflow, milli(715));
    assert_eq!(ledger.bond_consumed, 0);
    let task = h.task("task-1");
    assert_eq!(task.state, TaskState::Funded);
    assert_eq!(task.state_version, 4);
    assert_eq!(task.owner, customer());
    assert_eq!(task.guarantor, Some(guarantor()));
}

#[test]
fn funding_events_use_backstop_nep297_envelope() {
    let mut h = Harness::new();
    h.create_task("task-1", milli(400));
    let emitted = events();
    assert_eq!(emitted.len(), 1);
    let event = &emitted[0];
    assert_eq!(event["standard"], "backstop");
    assert_eq!(event["version"], "1.0.0");
    assert_eq!(event["event"], "task_funded");
    assert_eq!(event["data"][0]["task_id"], "task-1");
    assert_eq!(event["data"][0]["escrow"], milli(400).to_string());
    assert_eq!(event["data"][0]["premium"], "0");
    assert_eq!(event["data"][0]["manifest_hash"], "01".repeat(32));
    assert_eq!(event["data"][0]["state_version"], 1);

    h.post_guarantee("task-1", milli(250), milli(250));
    assert_eq!(event_names(), vec!["guarantee_posted"]);
    assert_eq!(
        events()[0]["data"][0]["liability_cap"],
        milli(250).to_string()
    );
}

#[test]
fn duplicate_task_id_rejected() {
    let mut h = Harness::new();
    h.create_task("task-1", milli(400));
    let before = h.task("task-1");
    h.act(&stranger(), milli(500));
    expect_error(ERR_TASK_EXISTS, || {
        h.vault
            .create_task("task-1".to_string(), hash(9), h.policy(3, 0))
    });
    assert_eq!(h.task("task-1"), before);
}

#[test]
fn dust_escrow_rejected() {
    let mut h = Harness::new();
    h.create_task("task-min", MIN_ESCROW);
    assert_eq!(h.ledger("task-min").escrow_available, MIN_ESCROW);
    h.act(&customer(), MIN_ESCROW - 1);
    expect_error(ERR_DUST_ESCROW, || {
        h.vault
            .create_task("task-dust".to_string(), hash(1), h.policy(3, 0))
    });
    assert!(h.vault.get_task("task-dust".to_string()).is_none());
}

#[test]
fn malformed_task_ids_rejected() {
    let mut h = Harness::new();
    let too_long = "a".repeat(65);
    for task_id in [
        "",
        "Upper",
        "has space",
        "under_score",
        "dot.ted",
        too_long.as_str(),
    ] {
        h.act(&customer(), milli(400));
        expect_error(ERR_INVALID_TASK_ID, || {
            h.vault
                .create_task(task_id.to_string(), hash(1), h.policy(3, 0))
        });
    }
    h.create_task(&"a".repeat(64), milli(400));
}

#[test]
fn post_guarantee_rejects_coverage_above_bond() {
    let mut h = Harness::new();
    h.create_task("task-1", milli(400));
    let before = h.ledger("task-1");
    h.act(&guarantor(), milli(250));
    expect_error(ERR_LIABILITY_EXCEEDS_BOND, || {
        h.vault
            .post_guarantee("task-1".to_string(), U128(milli(250) + 1))
    });
    assert_eq!(h.ledger("task-1"), before);
    h.post_guarantee("task-1", milli(250), milli(250));
    assert_eq!(h.ledger("task-1").max_bond_liability, milli(250));
}

#[test]
fn guarantee_rules_protect_the_customer() {
    let mut h = Harness::new();
    let mut policy = h.policy(3, 0);
    policy.min_liability = milli(100);
    h.create_with_policy("task-1", milli(400), policy);
    h.act(&customer(), milli(250));
    expect_error(ERR_SELF_GUARANTEE, || {
        h.vault
            .post_guarantee("task-1".to_string(), U128(milli(100)))
    });
    h.act(&guarantor(), milli(250));
    expect_error(ERR_LIABILITY_BELOW_MIN, || {
        h.vault
            .post_guarantee("task-1".to_string(), U128(milli(99)))
    });
    h.post_guarantee("task-1", milli(250), milli(100));
    h.act(&stranger(), milli(300));
    expect_error(ERR_GUARANTOR_EXISTS, || {
        h.vault
            .post_guarantee("task-1".to_string(), U128(milli(300)))
    });
    h.assert_invariants("task-1");
}

#[test]
fn only_task_owner_adds_escrow_or_premium() {
    let mut h = Harness::new();
    h.create_task("task-1", milli(400));
    h.act(&stranger(), milli(10));
    expect_error(ERR_NOT_TASK_OWNER, || {
        h.vault.fund_task("task-1".to_string())
    });
    h.act(&guarantor(), milli(10));
    expect_error(ERR_NOT_TASK_OWNER, || {
        h.vault.fund_premium("task-1".to_string())
    });
    assert_eq!(h.ledger("task-1").total_inflow, milli(400));
}

#[test]
fn manifest_cannot_change_after_funding() {
    let mut h = Harness::new();
    h.fund_demo("task-1", milli(250));
    let original = h.task("task-1");
    h.assign("task-1", 1, &[(agent("a"), milli(300))]);
    let assigned = h.ledger("task-1");

    h.act(&customer(), milli(10));
    expect_error(ERR_FUNDING_CLOSED, || {
        h.vault.fund_task("task-1".to_string())
    });
    h.act(&customer(), milli(10));
    expect_error(ERR_FUNDING_CLOSED, || {
        h.vault.fund_premium("task-1".to_string())
    });
    h.act(&stranger(), milli(10));
    expect_error(ERR_FUNDING_CLOSED, || {
        h.vault.post_guarantee("task-1".to_string(), U128(milli(5)))
    });
    assert_eq!(h.ledger("task-1"), assigned);

    h.verdict("task-1", 1, VerdictOutcome::Accept);
    h.finalize_success("task-1");
    h.confirm_all("task-1");
    let settled = h.task("task-1");
    assert_eq!(settled.state, TaskState::Settled);
    assert_eq!(settled.manifest_hash, original.manifest_hash);
    assert_eq!(settled.policy, original.policy);
    assert_eq!(settled.owner, original.owner);
}
