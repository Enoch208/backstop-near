use std::panic::{catch_unwind, AssertUnwindSafe};

use near_sdk::mock::MockAction;
use near_sdk::serde_json::{self, Value};
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::{
    test_vm_config, testing_env, AccountId, NearToken, PromiseResult, RuntimeFeesConfig,
};

use super::fixtures::vault_account;
use crate::events::EVENT_LOG_PREFIX;

pub fn set_context(caller: &AccountId, deposit: u128, now: u64, results: Vec<PromiseResult>) {
    let context = VMContextBuilder::new()
        .current_account_id(vault_account())
        .predecessor_account_id(caller.clone())
        .signer_account_id(caller.clone())
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .block_timestamp(now)
        .build();
    testing_env!(
        context,
        test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        results
    );
}

pub fn panic_message(payload: Box<dyn std::any::Any + Send>) -> String {
    payload
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| payload.downcast_ref::<&str>().map(|text| text.to_string()))
        .unwrap_or_default()
}

pub fn expect_error<R>(code: &str, action: impl FnOnce() -> R) {
    match catch_unwind(AssertUnwindSafe(action)) {
        Ok(_) => panic!("expected {code}, but the call succeeded"),
        Err(payload) => {
            let message = panic_message(payload);
            assert!(message.contains(code), "expected {code}, got: {message}");
        }
    }
}

pub fn events() -> Vec<Value> {
    get_logs()
        .iter()
        .filter_map(|line| line.strip_prefix(EVENT_LOG_PREFIX))
        .map(|json| serde_json::from_str(json).expect("events are valid JSON"))
        .collect()
}

pub fn event_names() -> Vec<String> {
    events()
        .iter()
        .map(|event| event["event"].as_str().unwrap_or_default().to_string())
        .collect()
}

pub fn scheduled_payments() -> Vec<(AccountId, u128)> {
    get_created_receipts()
        .into_iter()
        .flat_map(|receipt| {
            let receiver = receipt.receiver_id.clone();
            receipt
                .actions
                .into_iter()
                .filter_map(move |action| match action {
                    MockAction::Transfer { deposit, .. } => {
                        Some((receiver.clone(), deposit.as_yoctonear()))
                    }
                    _ => None,
                })
        })
        .collect()
}
