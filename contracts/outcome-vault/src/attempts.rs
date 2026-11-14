use near_sdk::json_types::U128;
use near_sdk::{env, near, require, AccountId};

use crate::errors::{
    ERR_ATTEMPTS_EXHAUSTED, ERR_BUDGET_EXCEEDED, ERR_CONFLICTED_PAYEE, ERR_DEADLINE_PASSED,
    ERR_INVALID_STATE, ERR_LEAD_NOT_PAYEE, ERR_STALE_ATTEMPT, ERR_VERDICT_EXISTS,
};
use crate::events;
use crate::hash::Hash32;
use crate::inference::InferenceReceipt;
use crate::math::add;
use crate::model::{Assignment, TaskState, Verdict, VerdictOutcome};
use crate::validation::{validate_failure_code, validate_payees};
use crate::{OutcomeVault, OutcomeVaultExt};

pub const REJECTED_VERDICT_REASON: &str = "VERDICT_REJECTED";

#[near]
impl OutcomeVault {
    pub fn register_assignment(
        &mut self,
        task_id: String,
        attempt: u32,
        agent: AccountId,
        bid_hash: Hash32,
        amount: U128,
        payees: Vec<(AccountId, U128)>,
    ) {
        self.require_coordinator();
        let mut task = self.load_task(&task_id);
        require!(
            matches!(task.state, TaskState::Funded | TaskState::RecoveryOpen),
            ERR_INVALID_STATE
        );
        require!(attempt == task.next_attempt(), ERR_STALE_ATTEMPT);
        require!(attempt <= task.policy.max_attempts, ERR_ATTEMPTS_EXHAUSTED);
        require!(!task.deadline_passed(), ERR_DEADLINE_PASSED);
        let payees = validate_payees(payees, amount.0);
        require!(
            payees.iter().any(|(account, _)| *account == agent),
            ERR_LEAD_NOT_PAYEE
        );
        require!(
            payees.iter().all(|(account, _)| *account != task.owner
                && task.guarantor.as_ref() != Some(account)
                && *account != self.coordinator
                && *account != self.verifier
                && *account != env::current_account_id()),
            ERR_CONFLICTED_PAYEE
        );
        require!(
            amount.0 <= add(task.escrow_available, task.bond_headroom()),
            ERR_BUDGET_EXCEEDED
        );
        let assignment = Assignment {
            attempt,
            agent,
            bid_hash,
            amount: amount.0,
            payees,
            assigned_at_ns: env::block_timestamp(),
        };
        task.state = TaskState::Assigned;
        task.current_attempt = attempt;
        task.verdict = None;
        task.assignment = Some(assignment.clone());
        let task = self.commit(task, Vec::new());
        events::attempt_assigned(&task, &assignment);
    }

    pub fn open_recovery(&mut self, task_id: String, failure_code: String) {
        self.require_coordinator();
        validate_failure_code(&failure_code);
        let mut task = self.load_task(&task_id);
        require!(task.state == TaskState::Assigned, ERR_INVALID_STATE);
        task.state = if task.attempts_exhausted() {
            TaskState::TerminalFailure
        } else {
            TaskState::RecoveryOpen
        };
        let task = self.commit(task, Vec::new());
        events::attempt_closed(&task, &failure_code);
    }

    pub fn record_verdict(
        &mut self,
        task_id: String,
        attempt: u32,
        artifact_hash: Hash32,
        suite_hash: Hash32,
        evidence_hash: Hash32,
        outcome: VerdictOutcome,
    ) {
        let hashes = [artifact_hash, suite_hash, evidence_hash];
        self.apply_verdict(task_id, attempt, hashes, outcome, None);
    }

    pub fn record_attested_verdict(
        &mut self,
        task_id: String,
        attempt: u32,
        artifact_hash: Hash32,
        suite_hash: Hash32,
        evidence_hash: Hash32,
        inference: InferenceReceipt,
    ) {
        let hashes = [artifact_hash, suite_hash, evidence_hash];
        self.apply_verdict(
            task_id,
            attempt,
            hashes,
            VerdictOutcome::Accept,
            Some(&inference),
        );
    }
}

impl OutcomeVault {
    fn apply_verdict(
        &mut self,
        task_id: String,
        attempt: u32,
        [artifact_hash, suite_hash, evidence_hash]: [Hash32; 3],
        outcome: VerdictOutcome,
        inference: Option<&InferenceReceipt>,
    ) {
        self.require_verifier();
        let mut task = self.load_task(&task_id);
        require!(
            attempt > 0 && attempt == task.current_attempt,
            ERR_STALE_ATTEMPT
        );
        require!(task.verdict.is_none(), ERR_VERDICT_EXISTS);
        require!(task.state == TaskState::Assigned, ERR_STALE_ATTEMPT);
        require!(!task.deadline_passed(), ERR_DEADLINE_PASSED);
        let verdict = Verdict {
            attempt,
            outcome,
            artifact_hash,
            suite_hash,
            evidence_hash,
            signer: env::predecessor_account_id(),
            recorded_at_ns: env::block_timestamp(),
        };
        task.state = match outcome {
            VerdictOutcome::Accept => TaskState::Accepted,
            VerdictOutcome::Reject if task.attempts_exhausted() => TaskState::TerminalFailure,
            VerdictOutcome::Reject => TaskState::RecoveryOpen,
        };
        task.verdict = Some(verdict.clone());
        let attested = inference
            .map(|receipt| self.attest_inference(&task_id, attempt, artifact_hash, receipt));
        let task = self.commit(task, Vec::new());
        events::verdict_recorded(&task, &verdict);
        if let Some(attested) = &attested {
            events::inference_attested(attested);
        }
        if outcome == VerdictOutcome::Reject {
            events::attempt_closed(&task, REJECTED_VERDICT_REASON);
        }
    }
}
