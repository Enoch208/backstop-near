use std::collections::BTreeMap;

use near_sdk::serde_with::DisplayFromStr;
use near_sdk::{env, near, serde_json, AccountId};

use crate::errors::ERR_ENCODING;
use crate::hash::Hash32;
use crate::math::{add, sum};
use crate::model::{Pool, TaskState, TransferStatus};
use crate::task::Task;
use crate::transfer::Transfer;

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RecipientTotal {
    pub recipient: AccountId,
    #[serde_as(as = "DisplayFromStr")]
    pub amount: u128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LedgerView {
    pub task_id: String,
    pub state: TaskState,
    pub state_version: u64,
    #[serde_as(as = "DisplayFromStr")]
    pub inflow_escrow: u128,
    #[serde_as(as = "DisplayFromStr")]
    pub inflow_premium: u128,
    #[serde_as(as = "DisplayFromStr")]
    pub inflow_bond: u128,
    #[serde_as(as = "DisplayFromStr")]
    pub total_inflow: u128,
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
    #[serde_as(as = "DisplayFromStr")]
    pub outflow_escrow: u128,
    #[serde_as(as = "DisplayFromStr")]
    pub outflow_premium: u128,
    #[serde_as(as = "DisplayFromStr")]
    pub outflow_bond: u128,
    #[serde_as(as = "DisplayFromStr")]
    pub pending_outflow: u128,
    #[serde_as(as = "DisplayFromStr")]
    pub failed_outflow: u128,
    #[serde_as(as = "DisplayFromStr")]
    pub confirmed_outflow: u128,
    pub confirmed_by_recipient: Vec<RecipientTotal>,
}

impl LedgerView {
    pub fn build(task: &Task, transfers: &[Transfer]) -> Self {
        let outflow = |status: TransferStatus| {
            sum(transfers
                .iter()
                .filter(|transfer| transfer.status == status)
                .map(|transfer| transfer.amount))
        };
        let pool_outflow = |pool: Pool| {
            sum(transfers
                .iter()
                .filter(|transfer| transfer.pool == pool)
                .map(|transfer| transfer.amount))
        };
        Self {
            task_id: task.task_id.clone(),
            state: task.state,
            state_version: task.state_version,
            inflow_escrow: task.inflow_escrow,
            inflow_premium: task.inflow_premium,
            inflow_bond: task.inflow_bond,
            total_inflow: task.total_inflow(),
            escrow_available: task.escrow_available,
            premium_available: task.premium_available,
            bond_available: task.bond_available,
            max_bond_liability: task.max_bond_liability,
            bond_consumed: task.bond_consumed,
            outflow_escrow: pool_outflow(Pool::Escrow),
            outflow_premium: pool_outflow(Pool::Premium),
            outflow_bond: pool_outflow(Pool::Bond),
            pending_outflow: outflow(TransferStatus::Pending),
            failed_outflow: outflow(TransferStatus::Failed),
            confirmed_outflow: outflow(TransferStatus::Confirmed),
            confirmed_by_recipient: confirmed_by_recipient(transfers),
        }
    }

    pub fn is_conserved(&self) -> bool {
        let pools_disjoint = self.inflow_escrow == add(self.escrow_available, self.outflow_escrow)
            && self.inflow_premium == add(self.premium_available, self.outflow_premium)
            && self.inflow_bond == add(self.bond_available, self.outflow_bond);
        let held = sum([
            self.escrow_available,
            self.premium_available,
            self.bond_available,
        ]);
        let outflow = sum([
            self.pending_outflow,
            self.failed_outflow,
            self.confirmed_outflow,
        ]);
        pools_disjoint && self.total_inflow == add(held, outflow)
    }

    pub fn liability_within_bounds(&self) -> bool {
        self.bond_consumed <= self.max_bond_liability && self.max_bond_liability <= self.inflow_bond
    }

    pub fn canonical_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| env::panic_str(ERR_ENCODING))
    }

    pub fn hash(&self) -> Hash32 {
        Hash32::of(self.canonical_json())
    }
}

fn confirmed_by_recipient(transfers: &[Transfer]) -> Vec<RecipientTotal> {
    let mut totals: BTreeMap<AccountId, u128> = BTreeMap::new();
    for transfer in transfers
        .iter()
        .filter(|transfer| transfer.status == TransferStatus::Confirmed)
    {
        let total = totals.entry(transfer.recipient.clone()).or_insert(0);
        *total = add(*total, transfer.amount);
    }
    totals
        .into_iter()
        .map(|(recipient, amount)| RecipientTotal { recipient, amount })
        .collect()
}
