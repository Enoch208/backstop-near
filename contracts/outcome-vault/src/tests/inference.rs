use near_sdk::store::LookupMap;
use near_sdk::{env, BorshStorageKey};

use super::harness::*;
use crate::{
    InferenceReceipt, OutcomeVault, TaskState, ERR_INFERENCE_FORMAT, ERR_INFERENCE_MODEL,
    ERR_INFERENCE_SIGNATURE, ERR_NOT_OWNER, ERR_NOT_VERIFIER, ERR_UNKNOWN_TEE_SIGNER,
};

const MODEL: &str = "deepseek-ai/DeepSeek-V4.1-Flash-1017";
const SIGNER: &str = "0x6efa5b49c88d75f66013053f4f89c6fbd319d6d9";
const TEXT: &str = "deepseek-ai/DeepSeek-V4.1-Flash-1017:1f58b9145b24d108d7ac38887338b3ea3229833b9c1e418250343f907bfd1047:a9f4b3d22a523fdada41c85c175425bcd15b32b4cd0f54d9433accd52d7195a1";
const SIGNATURE: &str = "0x0d984cd27696e1ca62073c76a50ebebb573ffb053a85f64da205052b7759a21522f12bd116d1761a6da5a5eaf77481295ac3e7bef2e152e204c56b28d3fdd0c41b";

fn receipt(text: &str, signature: &str) -> InferenceReceipt {
    InferenceReceipt {
        signed_text: text.to_string(),
        signature: signature.to_string(),
    }
}

fn register(h: &mut Harness, model: &str) {
    h.act(&owner(), 0);
    h.vault.register_tee_signer(
        SIGNER.to_uppercase().replace("0X", "0x"),
        model.to_string(),
        hash(40),
    );
}

fn assigned(h: &mut Harness) {
    h.fund_demo("task-1", milli(250));
    h.assign("task-1", 1, &[(agent("gamma"), milli(130))]);
}

fn accept(h: &mut Harness, receipt: InferenceReceipt) {
    h.act(&verifier(), 0);
    h.vault.record_attested_verdict(
        "task-1".to_string(),
        1,
        hash(10),
        hash(11),
        hash(12),
        receipt,
    );
}

#[test]
fn an_attested_receipt_is_verified_and_recorded_with_the_verdict() {
    let mut h = Harness::new();
    register(&mut h, MODEL);
    assigned(&mut h);
    accept(&mut h, receipt(TEXT, SIGNATURE));
    assert_eq!(
        event_names(),
        vec!["verdict_recorded", "inference_attested"]
    );
    let inference = h
        .vault
        .get_inference("task-1".to_string(), 1)
        .expect("inference recorded");
    assert_eq!(inference.signer, SIGNER);
    assert_eq!(inference.model, MODEL);
    assert_eq!(inference.artifact_hash, hash(10));
    assert_eq!(h.task("task-1").state, TaskState::Accepted);
}

#[test]
fn a_tampered_text_recovers_an_unregistered_key() {
    let mut h = Harness::new();
    register(&mut h, MODEL);
    assigned(&mut h);
    let tampered = TEXT.replace(":1f58", ":2f58");
    expect_error(ERR_UNKNOWN_TEE_SIGNER, || {
        accept(&mut h, receipt(&tampered, SIGNATURE))
    });
    assert_eq!(h.task("task-1").state, TaskState::Assigned);
    assert!(h.vault.get_inference("task-1".to_string(), 1).is_none());
}

#[test]
fn an_unregistered_or_revoked_signer_is_refused() {
    let mut h = Harness::new();
    assigned(&mut h);
    expect_error(ERR_UNKNOWN_TEE_SIGNER, || {
        accept(&mut h, receipt(TEXT, SIGNATURE))
    });
    register(&mut h, MODEL);
    h.act(&owner(), 0);
    h.vault.revoke_tee_signer(SIGNER.to_string());
    assert!(h.vault.get_tee_signer(SIGNER.to_string()).is_none());
    expect_error(ERR_UNKNOWN_TEE_SIGNER, || {
        accept(&mut h, receipt(TEXT, SIGNATURE))
    });
}

#[test]
fn a_signer_attested_for_another_model_is_refused() {
    let mut h = Harness::new();
    register(&mut h, "z-ai/glm-5.3-flash");
    assigned(&mut h);
    expect_error(ERR_INFERENCE_MODEL, || {
        accept(&mut h, receipt(TEXT, SIGNATURE))
    });
}

#[test]
fn malformed_receipts_are_refused() {
    let mut h = Harness::new();
    register(&mut h, MODEL);
    assigned(&mut h);
    let short = &SIGNATURE[..SIGNATURE.len() - 2];
    expect_error(ERR_INFERENCE_SIGNATURE, || {
        accept(&mut h, receipt(TEXT, short))
    });
    let bad_v = format!("{}1d", &SIGNATURE[..SIGNATURE.len() - 2]);
    expect_error(ERR_INFERENCE_SIGNATURE, || {
        accept(&mut h, receipt(TEXT, &bad_v))
    });
    expect_error(ERR_INFERENCE_FORMAT, || {
        accept(&mut h, receipt("only-one-part", SIGNATURE))
    });
    expect_error(ERR_INFERENCE_FORMAT, || {
        accept(&mut h, receipt("a:b:c:d", SIGNATURE))
    });
}

#[test]
fn only_the_verifier_records_an_attested_verdict() {
    let mut h = Harness::new();
    register(&mut h, MODEL);
    assigned(&mut h);
    h.act(&coordinator(), 0);
    expect_error(ERR_NOT_VERIFIER, || {
        h.vault.record_attested_verdict(
            "task-1".to_string(),
            1,
            hash(10),
            hash(11),
            hash(12),
            receipt(TEXT, SIGNATURE),
        )
    });
}

#[test]
fn only_the_owner_registers_tee_signers() {
    let mut h = Harness::new();
    for caller in [coordinator(), verifier(), stranger()] {
        h.act(&caller, 0);
        expect_error(ERR_NOT_OWNER, || {
            h.vault
                .register_tee_signer(SIGNER.to_string(), MODEL.to_string(), hash(40))
        });
    }
    h.act(&owner(), 0);
    expect_error(ERR_INFERENCE_FORMAT, || {
        h.vault
            .register_tee_signer("0x1234".to_string(), MODEL.to_string(), hash(40))
    });
}

#[near_sdk::near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum V1Key {
    Tasks,
    Transfers,
}

#[near_sdk::near(serializers = [borsh])]
struct V1 {
    owner: near_sdk::AccountId,
    coordinator: near_sdk::AccountId,
    verifier: near_sdk::AccountId,
    tasks: LookupMap<String, crate::Task>,
    transfers: LookupMap<String, crate::Transfer>,
}

#[test]
fn migrate_keeps_every_task_and_adds_an_empty_registry() {
    let mut h = Harness::new();
    h.fund_demo("task-1", milli(250));
    let before = h.task("task-1");
    let mut tasks = LookupMap::new(V1Key::Tasks);
    tasks.insert("task-1".to_string(), before.clone());
    tasks.flush();
    env::state_write(&V1 {
        owner: owner(),
        coordinator: coordinator(),
        verifier: verifier(),
        tasks,
        transfers: LookupMap::new(V1Key::Transfers),
    });
    h.act(&vault_account(), 0);
    let migrated = OutcomeVault::migrate();
    assert_eq!(migrated.get_task("task-1".to_string()), Some(before));
    assert_eq!(migrated.get_roles().verifier, verifier());
    assert!(migrated.get_tee_signer(SIGNER.to_string()).is_none());
}

#[test]
fn a_second_upgrade_keeps_current_tasks_and_attestations() {
    let mut h = Harness::new();
    register(&mut h, MODEL);
    assigned(&mut h);
    h.act(&verifier(), 0);
    accept(&mut h, receipt(TEXT, SIGNATURE));
    let task = h.task("task-1");
    let signer = h.vault.get_tee_signer(SIGNER.to_string());
    let inference = h.vault.get_inference("task-1".to_string(), 1);
    assert!(inference.is_some());
    h.vault.tasks.flush();
    h.vault.tee_signers.flush();
    h.vault.inferences.flush();
    env::state_write(&h.vault);
    h.act(&vault_account(), 0);
    let migrated = OutcomeVault::migrate();
    assert_eq!(migrated.get_task("task-1".to_string()), Some(task));
    assert_eq!(migrated.get_tee_signer(SIGNER.to_string()), signer);
    assert_eq!(migrated.get_inference("task-1".to_string(), 1), inference);
}
