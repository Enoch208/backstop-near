use near_sdk::json_types::U128;
use near_sdk::mock::with_mocked_blockchain;
use near_sdk::{AccountId, PromiseResult};

pub use super::chain::*;
pub use super::fixtures::*;
use crate::{
    LedgerView, OutcomeVault, Pool, Task, TaskPolicy, Transfer, TransferStatus, VerdictOutcome,
};

pub struct Harness {
    pub vault: OutcomeVault,
    pub now: u64,
}

impl Harness {
    pub fn new() -> Self {
        with_mocked_blockchain(|chain| chain.take_storage());
        set_context(&owner(), 0, START_NS, Vec::new());
        let vault = OutcomeVault::new(owner(), coordinator(), verifier());
        Self {
            vault,
            now: START_NS,
        }
    }

    pub fn act(&self, caller: &AccountId, deposit: u128) {
        set_context(caller, deposit, self.now, Vec::new());
    }

    pub fn policy(&self, max_attempts: u32, compensation_cap: u128) -> TaskPolicy {
        TaskPolicy {
            deadline_ns: self.now + HOUR_NS,
            max_attempts,
            compensation_cap,
            min_bond: 0,
            min_liability: 0,
        }
    }

    pub fn create_with_policy(&mut self, task_id: &str, escrow: u128, policy: TaskPolicy) {
        self.act(&customer(), escrow);
        self.vault.create_task(task_id.to_string(), hash(1), policy);
    }

    pub fn create_task(&mut self, task_id: &str, escrow: u128) {
        let policy = self.policy(3, milli(100));
        self.create_with_policy(task_id, escrow, policy);
    }

    pub fn fund_premium(&mut self, task_id: &str, premium: u128) {
        self.act(&customer(), premium);
        self.vault.fund_premium(task_id.to_string());
    }

    pub fn post_guarantee(&mut self, task_id: &str, bond: u128, liability: u128) {
        self.act(&guarantor(), bond);
        self.vault
            .post_guarantee(task_id.to_string(), U128(liability));
    }

    pub fn fund_demo(&mut self, task_id: &str, liability: u128) {
        self.create_task(task_id, milli(400));
        self.fund_premium(task_id, milli(40));
        self.post_guarantee(task_id, milli(250), liability);
    }

    pub fn assign(&mut self, task_id: &str, attempt: u32, entries: &[(AccountId, u128)]) {
        let amount = entries.iter().map(|(_, share)| share).sum();
        self.act(&coordinator(), 0);
        self.vault.register_assignment(
            task_id.to_string(),
            attempt,
            entries[0].0.clone(),
            hash(attempt as u8),
            U128(amount),
            payees(entries),
        );
    }

    pub fn open_recovery(&mut self, task_id: &str, code: &str) {
        self.act(&coordinator(), 0);
        self.vault
            .open_recovery(task_id.to_string(), code.to_string());
    }

    pub fn verdict(&mut self, task_id: &str, attempt: u32, outcome: VerdictOutcome) {
        self.act(&verifier(), 0);
        self.vault.record_verdict(
            task_id.to_string(),
            attempt,
            hash(10),
            hash(11),
            hash(12),
            outcome,
        );
    }

    pub fn finalize_success(&mut self, task_id: &str) {
        self.act(&coordinator(), 0);
        self.vault.finalize_success(task_id.to_string());
    }

    pub fn finalize_failure(&mut self, task_id: &str) {
        self.act(&coordinator(), 0);
        self.vault.finalize_failure(task_id.to_string());
    }

    pub fn deliver(&mut self, transfer_id: &str, retry: u32, succeeded: bool) {
        let result = if succeeded {
            PromiseResult::Successful(Vec::new())
        } else {
            PromiseResult::Failed
        };
        set_context(&vault_account(), 0, self.now, vec![result]);
        self.vault
            .on_transfer_complete(transfer_id.to_string(), retry);
    }

    pub fn complete(&mut self, transfer_id: &str, succeeded: bool) {
        let retry = self.transfer(transfer_id).retries;
        self.deliver(transfer_id, retry, succeeded);
    }

    pub fn retry(&mut self, transfer_id: &str) {
        self.act(&stranger(), 0);
        self.vault.retry_failed_transfer(transfer_id.to_string());
    }

    pub fn confirm_all(&mut self, task_id: &str) {
        for transfer in self.transfers(task_id) {
            if transfer.status == TransferStatus::Pending {
                self.complete(&transfer.id, true);
                self.assert_invariants(task_id);
            }
        }
    }

    pub fn task(&self, task_id: &str) -> Task {
        self.vault
            .get_task(task_id.to_string())
            .expect("task exists")
    }

    pub fn ledger(&self, task_id: &str) -> LedgerView {
        self.vault
            .get_ledger(task_id.to_string())
            .expect("ledger exists")
    }

    pub fn transfer(&self, transfer_id: &str) -> Transfer {
        self.vault
            .get_transfer(transfer_id.to_string())
            .expect("transfer exists")
    }

    pub fn transfers(&self, task_id: &str) -> Vec<Transfer> {
        self.task(task_id)
            .transfer_ids
            .iter()
            .map(|id| self.transfer(id))
            .collect()
    }

    pub fn legs(&self, task_id: &str) -> Vec<(String, AccountId, u128, Pool)> {
        self.transfers(task_id)
            .into_iter()
            .map(|transfer| {
                (
                    transfer.id,
                    transfer.recipient,
                    transfer.amount,
                    transfer.pool,
                )
            })
            .collect()
    }

    pub fn confirmed_to(&self, task_id: &str, recipient: &AccountId) -> u128 {
        self.ledger(task_id)
            .confirmed_by_recipient
            .iter()
            .find(|total| &total.recipient == recipient)
            .map(|total| total.amount)
            .unwrap_or(0)
    }

    pub fn assert_invariants(&self, task_id: &str) {
        let task = self.task(task_id);
        let ledger = self.ledger(task_id);
        assert!(ledger.is_conserved(), "conservation broken: {ledger:?}");
        assert!(
            ledger.liability_within_bounds(),
            "liability broken: {ledger:?}"
        );
        let outflow = ledger.pending_outflow + ledger.failed_outflow + ledger.confirmed_outflow;
        assert_eq!(
            ledger.total_inflow,
            task.escrow_available + task.premium_available + task.bond_available + outflow
        );
        let customer_spent: u128 = self
            .transfers(task_id)
            .iter()
            .filter(|transfer| transfer.pool != Pool::Bond && transfer.recipient != task.owner)
            .map(|transfer| transfer.amount)
            .sum();
        assert!(customer_spent <= task.inflow_escrow + task.inflow_premium);
    }
}
