use near_sdk::{env, near, require};

use crate::errors::{
    ERR_ALREADY_SETTLED, ERR_CONSERVATION, ERR_DEADLINE_NOT_REACHED, ERR_INVALID_STATE,
    ERR_LIABILITY_EXCEEDED, ERR_NO_ACCEPTED_VERDICT, ERR_TRANSFERS_PENDING,
};
use crate::events;
use crate::hash::Hash32;
use crate::math::add;
use crate::model::{TaskState, TransferStatus, VerdictOutcome};
use crate::payout::{failure_plan, success_plan, PayoutPlan};
use crate::task::Task;
use crate::transfer::Transfer;
use crate::{OutcomeVault, OutcomeVaultExt};

pub fn settlement_key(task_id: &str, label: &str) -> Hash32 {
    Hash32::of(format!("{task_id}:{label}"))
}

pub fn transfer_id(task_id: &str, label: &str, index: usize) -> String {
    format!("{task_id}:{label}:{index}")
}

fn has_accepted_verdict(task: &Task) -> bool {
    task.verdict.as_ref().is_some_and(|verdict| {
        verdict.attempt == task.current_attempt && verdict.outcome == VerdictOutcome::Accept
    })
}

fn failure_eligible(task: &Task) -> bool {
    match task.state {
        TaskState::TerminalFailure => true,
        TaskState::Funded | TaskState::RecoveryOpen | TaskState::Assigned => {
            require!(task.deadline_passed(), ERR_DEADLINE_NOT_REACHED);
            true
        }
        _ => false,
    }
}

#[near]
impl OutcomeVault {
    pub fn finalize_success(&mut self, task_id: String) {
        let task = self.load_task(&task_id);
        self.require_settler(&task);
        require!(task.settlement_key.is_none(), ERR_ALREADY_SETTLED);
        require!(task.state == TaskState::Accepted, ERR_INVALID_STATE);
        require!(has_accepted_verdict(&task), ERR_NO_ACCEPTED_VERDICT);
        let assignment = task
            .assignment
            .clone()
            .filter(|assignment| assignment.attempt == task.current_attempt)
            .unwrap_or_else(|| env::panic_str(ERR_NO_ACCEPTED_VERDICT));
        let plan = success_plan(&task, &assignment);
        self.open_settlement(task, plan, TaskState::SettlementPending);
    }

    pub fn finalize_failure(&mut self, task_id: String) {
        let task = self.load_task(&task_id);
        self.require_settler(&task);
        require!(task.settlement_key.is_none(), ERR_ALREADY_SETTLED);
        require!(failure_eligible(&task), ERR_INVALID_STATE);
        let pending = self
            .task_transfers(&task)
            .iter()
            .any(|transfer| transfer.status == TransferStatus::Pending);
        require!(!pending, ERR_TRANSFERS_PENDING);
        let plan = failure_plan(&task);
        self.open_settlement(task, plan, TaskState::FailureSettlementPending);
    }
}

impl OutcomeVault {
    fn open_settlement(&mut self, mut task: Task, plan: PayoutPlan, pending_state: TaskState) {
        let transfers: Vec<Transfer> = plan
            .legs
            .into_iter()
            .enumerate()
            .map(|(index, leg)| {
                Transfer::pending(
                    transfer_id(&task.task_id, &plan.label, index),
                    &task.task_id,
                    leg.recipient,
                    leg.amount,
                    leg.pool,
                )
            })
            .collect();
        for transfer in &transfers {
            task.debit(transfer.pool, transfer.amount);
        }
        require!(task.total_available() == 0, ERR_CONSERVATION);
        task.bond_consumed = add(task.bond_consumed, plan.bond_spent);
        require!(
            task.bond_consumed <= task.max_bond_liability,
            ERR_LIABILITY_EXCEEDED
        );
        task.settlement_key = Some(settlement_key(&task.task_id, &plan.label));
        task.transfer_ids = transfers
            .iter()
            .map(|transfer| transfer.id.clone())
            .collect();
        task.state = if transfers.is_empty() {
            pending_state.settled()
        } else {
            pending_state
        };
        let task = self.commit(task, transfers.clone());
        for transfer in &transfers {
            events::transfer_scheduled(&task, transfer);
        }
        if task.state.is_settled() {
            events::task_settled(&task);
        }
        for transfer in &transfers {
            Self::dispatch(transfer);
        }
    }
}
