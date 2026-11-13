use near_sdk::serde_with::DisplayFromStr;
use near_sdk::{env, near, AccountId};

use crate::errors::ERR_ARITHMETIC;
use crate::hash::Hash32;
use crate::math::{add, sub, sum};
use crate::model::{Assignment, Pool, TaskPolicy, TaskState, Verdict};

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Task {
    pub task_id: String,
    pub owner: AccountId,
    pub manifest_hash: Hash32,
    pub policy: TaskPolicy,
    pub state: TaskState,
    pub state_version: u64,
    pub current_attempt: u32,
    #[serde_as(as = "DisplayFromStr")]
    pub escrow_available: u128,
    #[serde_as(as = "DisplayFromStr")]
    pub premium_available: u128,
    #[serde_as(as = "DisplayFromStr")]
    pub bond_available: u128,
    #[serde_as(as = "DisplayFromStr")]
    pub max_bond_liability: u128,
    #[serde_as(as = "DisplayFromStr")]
    pub bond_consumed: u128,
    pub guarantor: Option<AccountId>,
    pub assignment: Option<Assignment>,
    pub verdict: Option<Verdict>,
    pub settlement_key: Option<Hash32>,
    pub ledger_hash: Option<Hash32>,
    pub transfer_ids: Vec<String>,
    #[serde_as(as = "DisplayFromStr")]
    pub inflow_escrow: u128,
    #[serde_as(as = "DisplayFromStr")]
    pub inflow_premium: u128,
    #[serde_as(as = "DisplayFromStr")]
    pub inflow_bond: u128,
    #[serde_as(as = "DisplayFromStr")]
    pub created_at_ns: u64,
}

impl Task {
    pub fn open(
        task_id: String,
        owner: AccountId,
        manifest_hash: Hash32,
        policy: TaskPolicy,
        escrow: u128,
    ) -> Self {
        Self {
            task_id,
            owner,
            manifest_hash,
            policy,
            state: TaskState::Funded,
            state_version: 0,
            current_attempt: 0,
            escrow_available: escrow,
            premium_available: 0,
            bond_available: 0,
            max_bond_liability: 0,
            bond_consumed: 0,
            guarantor: None,
            assignment: None,
            verdict: None,
            settlement_key: None,
            ledger_hash: None,
            transfer_ids: Vec::new(),
            inflow_escrow: escrow,
            inflow_premium: 0,
            inflow_bond: 0,
            created_at_ns: env::block_timestamp(),
        }
    }

    pub fn accepts_funding(&self) -> bool {
        self.state == TaskState::Funded && self.current_attempt == 0
    }

    pub fn deadline_passed(&self) -> bool {
        env::block_timestamp() > self.policy.deadline_ns
    }

    pub fn attempts_exhausted(&self) -> bool {
        self.current_attempt >= self.policy.max_attempts || self.deadline_passed()
    }

    pub fn liability_headroom(&self) -> u128 {
        sub(self.max_bond_liability, self.bond_consumed)
    }

    pub fn bond_headroom(&self) -> u128 {
        self.liability_headroom().min(self.bond_available)
    }

    pub fn total_inflow(&self) -> u128 {
        sum([self.inflow_escrow, self.inflow_premium, self.inflow_bond])
    }

    pub fn total_available(&self) -> u128 {
        sum([
            self.escrow_available,
            self.premium_available,
            self.bond_available,
        ])
    }

    pub fn next_attempt(&self) -> u32 {
        self.current_attempt
            .checked_add(1)
            .unwrap_or_else(|| env::panic_str(ERR_ARITHMETIC))
    }

    pub fn credit(&mut self, pool: Pool, amount: u128) {
        match pool {
            Pool::Escrow => {
                self.escrow_available = add(self.escrow_available, amount);
                self.inflow_escrow = add(self.inflow_escrow, amount);
            }
            Pool::Premium => {
                self.premium_available = add(self.premium_available, amount);
                self.inflow_premium = add(self.inflow_premium, amount);
            }
            Pool::Bond => {
                self.bond_available = add(self.bond_available, amount);
                self.inflow_bond = add(self.inflow_bond, amount);
            }
        }
    }

    pub fn debit(&mut self, pool: Pool, amount: u128) {
        match pool {
            Pool::Escrow => self.escrow_available = sub(self.escrow_available, amount),
            Pool::Premium => self.premium_available = sub(self.premium_available, amount),
            Pool::Bond => self.bond_available = sub(self.bond_available, amount),
        }
    }
}
