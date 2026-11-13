use near_sdk::json_types::U128;
use near_sdk::AccountId;

use crate::Hash32;

pub const MILLI_NEAR: u128 = 1_000_000_000_000_000_000_000;
pub const START_NS: u64 = 1_700_000_000_000_000_000;
pub const HOUR_NS: u64 = 3_600_000_000_000;

pub fn milli(amount: u128) -> u128 {
    amount * MILLI_NEAR
}

pub fn account(name: &str) -> AccountId {
    name.parse().expect("test account ids are valid")
}

pub fn vault_account() -> AccountId {
    account("vault.near")
}

pub fn owner() -> AccountId {
    account("owner.near")
}

pub fn coordinator() -> AccountId {
    account("coordinator.near")
}

pub fn verifier() -> AccountId {
    account("verifier.near")
}

pub fn customer() -> AccountId {
    account("customer.near")
}

pub fn guarantor() -> AccountId {
    account("guarantor.near")
}

pub fn stranger() -> AccountId {
    account("stranger.near")
}

pub fn agent(name: &str) -> AccountId {
    account(&format!("agent-{name}.near"))
}

pub fn hash(tag: u8) -> Hash32 {
    Hash32([tag; 32])
}

pub fn payees(entries: &[(AccountId, u128)]) -> Vec<(AccountId, U128)> {
    entries
        .iter()
        .map(|(payee, amount)| (payee.clone(), U128(*amount)))
        .collect()
}
