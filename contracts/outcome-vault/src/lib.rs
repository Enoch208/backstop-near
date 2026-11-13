mod attempts;
mod errors;
mod events;
mod funding;
mod hash;
mod ledger;
mod math;
mod model;
mod payout;
mod roles;
mod settlement;
mod task;
mod transfer;
mod validation;
mod views;

#[cfg(test)]
mod tests;

use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, BorshStorageKey, PanicOnDefault};

pub use crate::errors::*;
pub use crate::hash::Hash32;
pub use crate::ledger::{LedgerView, RecipientTotal};
pub use crate::model::{
    Assignment, Pool, TaskPolicy, TaskState, TransferStatus, Verdict, VerdictOutcome,
};
pub use crate::roles::Roles;
pub use crate::task::Task;
pub use crate::transfer::{Transfer, MAX_TRANSFER_RETRIES};

#[near(serializers = [borsh])]
#[derive(BorshStorageKey)]
enum StorageKey {
    Tasks,
    Transfers,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct OutcomeVault {
    owner: AccountId,
    coordinator: AccountId,
    verifier: AccountId,
    tasks: LookupMap<String, Task>,
    transfers: LookupMap<String, Transfer>,
}

#[near]
impl OutcomeVault {
    #[init]
    pub fn new(owner: AccountId, coordinator: AccountId, verifier: AccountId) -> Self {
        roles::require_distinct_roles(&coordinator, &verifier);
        let vault = Self {
            owner,
            coordinator,
            verifier,
            tasks: LookupMap::new(StorageKey::Tasks),
            transfers: LookupMap::new(StorageKey::Transfers),
        };
        events::roles_updated(&vault.roles());
        vault
    }
}

impl OutcomeVault {
    pub(crate) fn load_task(&self, task_id: &str) -> Task {
        self.tasks
            .get(task_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str(ERR_UNKNOWN_TASK))
    }

    pub(crate) fn load_transfer(&self, transfer_id: &str) -> Transfer {
        self.transfers
            .get(transfer_id)
            .cloned()
            .unwrap_or_else(|| env::panic_str(ERR_UNKNOWN_TRANSFER))
    }

    pub(crate) fn task_transfers(&self, task: &Task) -> Vec<Transfer> {
        task.transfer_ids
            .iter()
            .map(|id| self.load_transfer(id))
            .collect()
    }

    pub(crate) fn ledger(&self, task: &Task) -> LedgerView {
        LedgerView::build(task, &self.task_transfers(task))
    }

    pub(crate) fn commit(&mut self, mut task: Task, transfers: Vec<Transfer>) -> Task {
        task.state_version = task
            .state_version
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str(ERR_ARITHMETIC));
        for transfer in transfers {
            self.transfers.insert(transfer.id.clone(), transfer);
        }
        let ledger = self.ledger(&task);
        require!(
            ledger.is_conserved() && ledger.liability_within_bounds(),
            ERR_CONSERVATION
        );
        if task.state.is_settled() && task.ledger_hash.is_none() {
            task.ledger_hash = Some(ledger.hash());
        }
        self.tasks.insert(task.task_id.clone(), task.clone());
        task
    }
}
