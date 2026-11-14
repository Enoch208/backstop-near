use near_sdk::serde_with::DisplayFromStr;
use near_sdk::{env, near, require, AccountId, Gas, PromiseError};

use crate::errors::{
    ERR_NOT_TRANSFER_RECIPIENT, ERR_RETRIES_REMAIN, ERR_RETRY_LIMIT, ERR_TRANSFER_NOT_FAILED,
    ERR_UNEXPECTED_CALLBACK,
};
use crate::events;
use crate::model::{Pool, TransferStatus};
use crate::task::Task;
use crate::token;
use crate::{OutcomeVault, OutcomeVaultExt};

pub const MAX_TRANSFER_RETRIES: u32 = 3;
const CALLBACK_GAS: Gas = Gas::from_tgas(10);

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Transfer {
    pub id: String,
    pub task_id: String,
    pub recipient: AccountId,
    #[serde_as(as = "DisplayFromStr")]
    pub amount: u128,
    pub pool: Pool,
    pub status: TransferStatus,
    pub retries: u32,
}

impl Transfer {
    pub fn pending(
        id: String,
        task_id: &str,
        recipient: AccountId,
        amount: u128,
        pool: Pool,
    ) -> Self {
        Self {
            id,
            task_id: task_id.to_string(),
            recipient,
            amount,
            pool,
            status: TransferStatus::Pending,
            retries: 0,
        }
    }

    fn awaits(&self, retry: u32) -> bool {
        self.status == TransferStatus::Pending && self.retries == retry
    }
}

fn single_promise_succeeded() -> bool {
    require!(env::promise_results_count() == 1, ERR_UNEXPECTED_CALLBACK);
    !matches!(env::promise_result_checked(0, 0), Err(PromiseError::Failed))
}

#[near]
impl OutcomeVault {
    #[private]
    pub fn on_transfer_complete(&mut self, transfer_id: String, retry: u32) {
        let mut transfer = self.load_transfer(&transfer_id);
        if !transfer.awaits(retry) {
            return;
        }
        let succeeded = single_promise_succeeded();
        transfer.status = if succeeded {
            TransferStatus::Confirmed
        } else {
            TransferStatus::Failed
        };
        let mut task = self.load_task(&transfer.task_id);
        if succeeded && self.all_confirmed_with(&task, &transfer) {
            task.state = task.state.settled();
        }
        let task = self.commit(task, vec![transfer.clone()]);
        if succeeded {
            events::transfer_confirmed(&task, &transfer);
        } else {
            events::transfer_failed(&task, &transfer);
        }
        if task.state.is_settled() {
            events::task_settled(&task);
        }
    }

    pub fn retry_failed_transfer(&mut self, transfer_id: String) {
        let transfer = self.load_transfer(&transfer_id);
        require!(
            transfer.status == TransferStatus::Failed,
            ERR_TRANSFER_NOT_FAILED
        );
        require!(transfer.retries < MAX_TRANSFER_RETRIES, ERR_RETRY_LIMIT);
        self.reschedule(transfer);
    }

    pub fn claim_failed_transfer(&mut self, transfer_id: String) {
        let transfer = self.load_transfer(&transfer_id);
        require!(
            env::predecessor_account_id() == transfer.recipient,
            ERR_NOT_TRANSFER_RECIPIENT
        );
        require!(
            transfer.status == TransferStatus::Failed,
            ERR_TRANSFER_NOT_FAILED
        );
        require!(transfer.retries >= MAX_TRANSFER_RETRIES, ERR_RETRIES_REMAIN);
        self.reschedule(transfer);
    }
}

impl OutcomeVault {
    fn reschedule(&mut self, mut transfer: Transfer) {
        transfer.retries = transfer
            .retries
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str(ERR_RETRY_LIMIT));
        transfer.status = TransferStatus::Pending;
        let task = self.load_task(&transfer.task_id);
        let task = self.commit(task, vec![transfer.clone()]);
        events::transfer_scheduled(&task, &transfer);
        Self::dispatch(&transfer);
    }

    pub(crate) fn dispatch(transfer: &Transfer) {
        token::payment(transfer.recipient.clone(), transfer.amount)
            .then(
                Self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_transfer_complete(transfer.id.clone(), transfer.retries),
            )
            .detach();
    }

    fn all_confirmed_with(&self, task: &Task, updated: &Transfer) -> bool {
        task.transfer_ids.iter().all(|id| {
            let status = if *id == updated.id {
                updated.status
            } else {
                self.load_transfer(id).status
            };
            status == TransferStatus::Confirmed
        })
    }
}
