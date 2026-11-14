use near_sdk::json_types::U128;
use near_sdk::serde_json::{json, Value};
use near_sdk::{env, AccountId};

use crate::inference::{Inference, TeeSigner};
use crate::model::{Assignment, TaskState, Verdict};
use crate::roles::Roles;
use crate::task::Task;
use crate::transfer::Transfer;

pub const EVENT_STANDARD: &str = "backstop";
pub const EVENT_VERSION: &str = "1.0.0";
pub const EVENT_LOG_PREFIX: &str = "EVENT_JSON:";

fn emit(event: &str, data: Value) {
    let envelope = json!({
        "standard": EVENT_STANDARD,
        "version": EVENT_VERSION,
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("{EVENT_LOG_PREFIX}{envelope}"));
}

pub fn roles_updated(roles: &Roles) {
    emit("roles_updated", json!(roles));
}

pub fn task_funded(task: &Task) {
    emit(
        "task_funded",
        json!({
            "task_id": task.task_id,
            "escrow": U128(task.escrow_available),
            "premium": U128(task.premium_available),
            "manifest_hash": task.manifest_hash,
            "state_version": task.state_version,
        }),
    );
}

pub fn guarantee_posted(task: &Task, guarantor: &AccountId) {
    emit(
        "guarantee_posted",
        json!({
            "task_id": task.task_id,
            "guarantor": guarantor,
            "bond": U128(task.bond_available),
            "liability_cap": U128(task.max_bond_liability),
            "state_version": task.state_version,
        }),
    );
}

pub fn attempt_assigned(task: &Task, assignment: &Assignment) {
    let payees: Vec<(&AccountId, U128)> = assignment
        .payees
        .iter()
        .map(|(account, amount)| (account, U128(*amount)))
        .collect();
    emit(
        "attempt_assigned",
        json!({
            "task_id": task.task_id,
            "attempt": assignment.attempt,
            "agent": assignment.agent,
            "bid_hash": assignment.bid_hash,
            "amount": U128(assignment.amount),
            "payees": payees,
            "state_version": task.state_version,
        }),
    );
}

pub fn attempt_closed(task: &Task, reason: &str) {
    let event = if task.state == TaskState::TerminalFailure {
        "terminal_failure"
    } else {
        "recovery_opened"
    };
    emit(
        event,
        json!({
            "task_id": task.task_id,
            "epoch": task.current_attempt,
            "reason": reason,
            "state": task.state,
            "state_version": task.state_version,
        }),
    );
}

pub fn verdict_recorded(task: &Task, verdict: &Verdict) {
    emit(
        "verdict_recorded",
        json!({
            "task_id": task.task_id,
            "attempt": verdict.attempt,
            "result": verdict.outcome,
            "artifact_hash": verdict.artifact_hash,
            "suite_hash": verdict.suite_hash,
            "evidence_hash": verdict.evidence_hash,
            "state_version": task.state_version,
        }),
    );
}

pub fn transfer_scheduled(task: &Task, transfer: &Transfer) {
    emit(
        "transfer_scheduled",
        json!({
            "task_id": task.task_id,
            "transfer_id": transfer.id,
            "recipient": transfer.recipient,
            "amount": U128(transfer.amount),
            "pool": transfer.pool,
            "retry": transfer.retries,
            "state_version": task.state_version,
        }),
    );
}

pub fn transfer_confirmed(task: &Task, transfer: &Transfer) {
    emit(
        "transfer_confirmed",
        json!({
            "task_id": task.task_id,
            "transfer_id": transfer.id,
            "recipient": transfer.recipient,
            "amount": U128(transfer.amount),
            "state_version": task.state_version,
        }),
    );
}

pub fn transfer_failed(task: &Task, transfer: &Transfer) {
    emit(
        "transfer_failed",
        json!({
            "task_id": task.task_id,
            "transfer_id": transfer.id,
            "reason": "PROMISE_FAILED",
            "retries": transfer.retries,
            "state_version": task.state_version,
        }),
    );
}

pub fn task_settled(task: &Task) {
    emit(
        "task_settled",
        json!({
            "task_id": task.task_id,
            "settlement_key": task.settlement_key,
            "ledger_hash": task.ledger_hash,
            "state": task.state,
            "state_version": task.state_version,
        }),
    );
}

pub fn tee_signer_registered(address: &str, signer: &TeeSigner) {
    emit(
        "tee_signer_registered",
        json!({
            "address": address,
            "model": signer.model,
            "attestation_hash": signer.attestation_hash,
        }),
    );
}

pub fn tee_signer_revoked(address: &str) {
    emit("tee_signer_revoked", json!({ "address": address }));
}

pub fn inference_attested(inference: &Inference) {
    emit("inference_attested", json!(inference));
}
