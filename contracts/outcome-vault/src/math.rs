use near_sdk::env;

use crate::errors::ERR_ARITHMETIC;

pub fn add(left: u128, right: u128) -> u128 {
    left.checked_add(right)
        .unwrap_or_else(|| env::panic_str(ERR_ARITHMETIC))
}

pub fn sub(left: u128, right: u128) -> u128 {
    left.checked_sub(right)
        .unwrap_or_else(|| env::panic_str(ERR_ARITHMETIC))
}

pub fn sum(amounts: impl IntoIterator<Item = u128>) -> u128 {
    amounts.into_iter().fold(0, add)
}
