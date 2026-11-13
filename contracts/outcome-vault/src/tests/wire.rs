use near_sdk::serde_json::{self, json};

use super::harness::*;
use crate::{Hash32, TaskPolicy, VerdictOutcome};

const DEMO_LEDGER_JSON: &str = concat!(
    r#"{"task_id":"demo","state":"SETTLED","state_version":14,"#,
    r#""inflow_escrow":"400000000000000000000000","inflow_premium":"40000000000000000000000","#,
    r#""inflow_bond":"250000000000000000000000","total_inflow":"690000000000000000000000","#,
    r#""escrow_available":"0","premium_available":"0","bond_available":"0","#,
    r#""max_bond_liability":"250000000000000000000000","bond_consumed":"120000000000000000000000","#,
    r#""outflow_escrow":"400000000000000000000000","outflow_premium":"40000000000000000000000","#,
    r#""outflow_bond":"250000000000000000000000","pending_outflow":"0","failed_outflow":"0","#,
    r#""confirmed_outflow":"690000000000000000000000","confirmed_by_recipient":["#,
    r#"{"recipient":"agent-c.near","amount":"400000000000000000000000"},"#,
    r#"{"recipient":"agent-d.near","amount":"120000000000000000000000"},"#,
    r#"{"recipient":"customer.near","amount":"40000000000000000000000"},"#,
    r#"{"recipient":"guarantor.near","amount":"130000000000000000000000"}]}"#
);
const DEMO_LEDGER_HASH: &str = "93a649d2a7bcfdabd6f7d12358655048caa417602ffbaf882fdf938cdf4b5423";
const DEMO_SETTLEMENT_KEY: &str =
    "2f13cec703a2be5a1c28cee364ca8c95665e63144b3cf37c8b2a9cb01cf98deb";

fn run_canonical_demo(h: &mut Harness) {
    h.fund_demo("demo", milli(250));
    h.assign("demo", 1, &[(agent("a"), milli(300))]);
    h.open_recovery("demo", "LEASE_EXPIRED");
    h.assign("demo", 2, &[(agent("b"), milli(350))]);
    h.verdict("demo", 2, VerdictOutcome::Reject);
    h.assign(
        "demo",
        3,
        &[(agent("c"), milli(400)), (agent("d"), milli(120))],
    );
    h.verdict("demo", 3, VerdictOutcome::Accept);
    h.finalize_success("demo");
    h.confirm_all("demo");
}

#[test]
fn canonical_demo_ledger_json_and_hashes_are_golden() {
    let mut h = Harness::new();
    run_canonical_demo(&mut h);
    let ledger = h.ledger("demo");
    assert_eq!(ledger.canonical_json(), DEMO_LEDGER_JSON);
    let task = serde_json::to_value(h.task("demo")).expect("task serializes");
    assert_eq!(task["ledger_hash"], DEMO_LEDGER_HASH);
    assert_eq!(task["settlement_key"], DEMO_SETTLEMENT_KEY);
    assert_eq!(
        serde_json::to_value(Hash32::of(DEMO_LEDGER_JSON)).expect("hash serializes"),
        DEMO_LEDGER_HASH
    );
}

#[test]
fn views_use_string_amounts_hex_hashes_and_screaming_enums() {
    let mut h = Harness::new();
    run_canonical_demo(&mut h);
    let transfer = serde_json::to_value(h.transfer("demo:3:1")).expect("transfer serializes");
    assert_eq!(
        transfer,
        json!({
            "id": "demo:3:1",
            "task_id": "demo",
            "recipient": "agent-d.near",
            "amount": "120000000000000000000000",
            "pool": "BOND",
            "status": "CONFIRMED",
            "retries": 0,
        })
    );
    let task = serde_json::to_value(h.task("demo")).expect("task serializes");
    assert_eq!(task["state"], "SETTLED");
    assert_eq!(task["manifest_hash"], "01".repeat(32));
    assert_eq!(
        task["policy"]["deadline_ns"],
        (START_NS + HOUR_NS).to_string()
    );
    assert_eq!(task["verdict"]["outcome"], "ACCEPT");
    assert_eq!(
        task["assignment"]["payees"],
        json!([
            ["agent-c.near", "400000000000000000000000"],
            ["agent-d.near", "120000000000000000000000"],
        ])
    );
}

#[test]
fn policy_minimums_default_to_zero() {
    let policy: TaskPolicy = serde_json::from_value(json!({
        "deadline_ns": "1700003600000000000",
        "max_attempts": 3,
        "compensation_cap": "100000000000000000000000",
    }))
    .expect("policy without minimums parses");
    assert_eq!(policy.deadline_ns, 1_700_003_600_000_000_000);
    assert_eq!(policy.compensation_cap, milli(100));
    assert_eq!((policy.min_bond, policy.min_liability), (0, 0));
}

#[test]
fn hash_arguments_require_32_hex_bytes() {
    let parse = |text: &str| serde_json::from_value::<Hash32>(json!(text));
    assert_eq!(parse(&"ab".repeat(32)).ok(), Some(Hash32([0xab; 32])));
    assert_eq!(parse(&"AB".repeat(32)).ok(), Some(Hash32([0xab; 32])));
    for malformed in [
        "ab".repeat(31),
        "ab".repeat(33),
        "zz".repeat(32),
        String::new(),
    ] {
        assert!(parse(&malformed).is_err(), "accepted {malformed}");
    }
}
