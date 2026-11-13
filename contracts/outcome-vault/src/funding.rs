use near_sdk::json_types::U128;
use near_sdk::{env, near, require};

use crate::errors::{
    ERR_BOND_BELOW_MIN, ERR_DEADLINE_IN_PAST, ERR_DEADLINE_PASSED, ERR_DUST_ESCROW,
    ERR_FUNDING_CLOSED, ERR_GUARANTOR_EXISTS, ERR_INVALID_POLICY, ERR_LIABILITY_BELOW_MIN,
    ERR_LIABILITY_EXCEEDS_BOND, ERR_NOT_TASK_OWNER, ERR_SELF_GUARANTEE, ERR_TASK_EXISTS,
    ERR_ZERO_DEPOSIT,
};
use crate::events;
use crate::hash::Hash32;
use crate::model::{Pool, TaskPolicy};
use crate::task::Task;
use crate::validation::validate_task_id;
use crate::{OutcomeVault, OutcomeVaultExt};

pub const MIN_ESCROW: u128 = 10_000_000_000_000_000_000_000;

fn attached_deposit() -> u128 {
    env::attached_deposit().as_yoctonear()
}

fn require_open_for_funding(task: &Task, deposit: u128) {
    require!(task.accepts_funding(), ERR_FUNDING_CLOSED);
    require!(!task.deadline_passed(), ERR_DEADLINE_PASSED);
    require!(deposit > 0, ERR_ZERO_DEPOSIT);
}

#[near]
impl OutcomeVault {
    #[payable]
    pub fn create_task(&mut self, task_id: String, manifest_hash: Hash32, policy: TaskPolicy) {
        validate_task_id(&task_id);
        require!(!self.tasks.contains_key(&task_id), ERR_TASK_EXISTS);
        let escrow = attached_deposit();
        require!(escrow >= MIN_ESCROW, ERR_DUST_ESCROW);
        require!(policy.max_attempts >= 1, ERR_INVALID_POLICY);
        require!(
            policy.deadline_ns > env::block_timestamp(),
            ERR_DEADLINE_IN_PAST
        );
        let task = Task::open(
            task_id,
            env::predecessor_account_id(),
            manifest_hash,
            policy,
            escrow,
        );
        let task = self.commit(task, Vec::new());
        events::task_funded(&task);
    }

    #[payable]
    pub fn fund_task(&mut self, task_id: String) {
        self.credit_owner_pool(&task_id, Pool::Escrow);
    }

    #[payable]
    pub fn fund_premium(&mut self, task_id: String) {
        self.credit_owner_pool(&task_id, Pool::Premium);
    }

    #[payable]
    pub fn post_guarantee(&mut self, task_id: String, max_liability: U128) {
        let mut task = self.load_task(&task_id);
        let guarantor = env::predecessor_account_id();
        let bond = attached_deposit();
        require!(guarantor != task.owner, ERR_SELF_GUARANTEE);
        require_open_for_funding(&task, bond);
        require!(task.guarantor.is_none(), ERR_GUARANTOR_EXISTS);
        require!(max_liability.0 <= bond, ERR_LIABILITY_EXCEEDS_BOND);
        require!(bond >= task.policy.min_bond, ERR_BOND_BELOW_MIN);
        require!(
            max_liability.0 >= task.policy.min_liability,
            ERR_LIABILITY_BELOW_MIN
        );
        task.credit(Pool::Bond, bond);
        task.max_bond_liability = max_liability.0;
        task.guarantor = Some(guarantor.clone());
        let task = self.commit(task, Vec::new());
        events::guarantee_posted(&task, &guarantor);
    }
}

impl OutcomeVault {
    fn credit_owner_pool(&mut self, task_id: &str, pool: Pool) {
        let mut task = self.load_task(task_id);
        let deposit = attached_deposit();
        require!(
            env::predecessor_account_id() == task.owner,
            ERR_NOT_TASK_OWNER
        );
        require_open_for_funding(&task, deposit);
        task.credit(pool, deposit);
        let task = self.commit(task, Vec::new());
        events::task_funded(&task);
    }
}
