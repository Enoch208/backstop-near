use near_sdk::near;

use crate::ledger::LedgerView;
use crate::roles::Roles;
use crate::task::Task;
use crate::transfer::Transfer;
use crate::{OutcomeVault, OutcomeVaultExt};

#[near]
impl OutcomeVault {
    pub fn get_task(&self, task_id: String) -> Option<Task> {
        self.tasks.get(&task_id).cloned()
    }

    pub fn get_ledger(&self, task_id: String) -> Option<LedgerView> {
        self.tasks.get(&task_id).map(|task| self.ledger(task))
    }

    pub fn get_transfer(&self, transfer_id: String) -> Option<Transfer> {
        self.transfers.get(&transfer_id).cloned()
    }

    pub fn get_roles(&self) -> Roles {
        self.roles()
    }
}
