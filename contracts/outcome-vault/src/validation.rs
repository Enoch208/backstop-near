use std::collections::BTreeSet;

use near_sdk::json_types::U128;
use near_sdk::{env, require, AccountId};

use crate::errors::{
    ERR_DUPLICATE_PAYEE, ERR_EMPTY_PAYEES, ERR_INVALID_FAILURE_CODE, ERR_INVALID_TASK_ID,
    ERR_PAYEE_SUM_MISMATCH, ERR_TOO_MANY_PAYEES, ERR_ZERO_PAYEE_AMOUNT,
};
use crate::math::add;

pub const MAX_TASK_ID_LEN: usize = 64;
pub const MAX_FAILURE_CODE_LEN: usize = 64;
pub const MAX_PAYEES: usize = 6;

pub fn validate_task_id(task_id: &str) {
    let well_formed = (1..=MAX_TASK_ID_LEN).contains(&task_id.len())
        && task_id
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-');
    require!(well_formed, ERR_INVALID_TASK_ID);
}

pub fn validate_failure_code(code: &str) {
    let well_formed = (1..=MAX_FAILURE_CODE_LEN).contains(&code.len())
        && code.bytes().all(|byte| byte.is_ascii_graphic());
    require!(well_formed, ERR_INVALID_FAILURE_CODE);
}

pub fn validate_payees(payees: Vec<(AccountId, U128)>, amount: u128) -> Vec<(AccountId, u128)> {
    require!(!payees.is_empty(), ERR_EMPTY_PAYEES);
    require!(payees.len() <= MAX_PAYEES, ERR_TOO_MANY_PAYEES);
    let mut seen = BTreeSet::new();
    let mut total = 0u128;
    let mut validated = Vec::with_capacity(payees.len());
    for (account, share) in payees {
        if !seen.insert(account.clone()) {
            env::panic_str(ERR_DUPLICATE_PAYEE);
        }
        require!(share.0 > 0, ERR_ZERO_PAYEE_AMOUNT);
        total = add(total, share.0);
        validated.push((account, share.0));
    }
    require!(total == amount, ERR_PAYEE_SUM_MISMATCH);
    validated
}
