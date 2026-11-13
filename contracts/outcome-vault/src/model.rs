use near_sdk::serde_with::DisplayFromStr;
use near_sdk::{env, near, AccountId};

use crate::errors::ERR_INVALID_STATE;
use crate::hash::Hash32;

#[near(serializers = [borsh, json])]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TaskState {
    Funded,
    Assigned,
    RecoveryOpen,
    Accepted,
    SettlementPending,
    Settled,
    TerminalFailure,
    FailureSettlementPending,
    FailureSettled,
}

impl TaskState {
    pub fn is_settled(self) -> bool {
        matches!(self, Self::Settled | Self::FailureSettled)
    }

    pub fn settled(self) -> Self {
        match self {
            Self::SettlementPending => Self::Settled,
            Self::FailureSettlementPending => Self::FailureSettled,
            _ => env::panic_str(ERR_INVALID_STATE),
        }
    }
}

#[near(serializers = [borsh, json])]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VerdictOutcome {
    Accept,
    Reject,
}

#[near(serializers = [borsh, json])]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pool {
    Escrow,
    Premium,
    Bond,
}

#[near(serializers = [borsh, json])]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TransferStatus {
    Pending,
    Confirmed,
    Failed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaskPolicy {
    #[serde_as(as = "DisplayFromStr")]
    pub deadline_ns: u64,
    pub max_attempts: u32,
    #[serde_as(as = "DisplayFromStr")]
    pub compensation_cap: u128,
    #[serde_as(as = "DisplayFromStr")]
    #[serde(default)]
    pub min_bond: u128,
    #[serde_as(as = "DisplayFromStr")]
    #[serde(default)]
    pub min_liability: u128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Assignment {
    pub attempt: u32,
    pub agent: AccountId,
    pub bid_hash: Hash32,
    #[serde_as(as = "DisplayFromStr")]
    pub amount: u128,
    #[serde_as(as = "Vec<(_, DisplayFromStr)>")]
    pub payees: Vec<(AccountId, u128)>,
    #[serde_as(as = "DisplayFromStr")]
    pub assigned_at_ns: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Verdict {
    pub attempt: u32,
    pub outcome: VerdictOutcome,
    pub artifact_hash: Hash32,
    pub suite_hash: Hash32,
    pub evidence_hash: Hash32,
    pub signer: AccountId,
    #[serde_as(as = "DisplayFromStr")]
    pub recorded_at_ns: u64,
}
