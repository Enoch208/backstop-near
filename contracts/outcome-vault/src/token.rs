use near_sdk::json_types::U128;
use near_sdk::serde::Deserialize;
use near_sdk::{env, near, require, AccountId, NearToken, Promise};

use crate::errors::{ERR_INVALID_TOKEN_FUNDING, ERR_WRONG_FUNDING_ASSET, ERR_WRONG_TOKEN_CONTRACT};
use crate::model::{Pool, TaskPolicy};
use crate::{Hash32, OutcomeVault, OutcomeVaultExt};

const TOKEN_ASSET: &[u8] = b"\0backstop-token-asset";

#[near(serializers = [borsh, json])]
pub struct TokenAsset {
    pub token_contract: AccountId,
    pub min_escrow: U128,
}

impl TokenAsset {
    pub(crate) fn set(token_contract: AccountId, min_escrow: U128) {
        env::storage_write(
            TOKEN_ASSET,
            &near_sdk::borsh::to_vec(&Self {
                token_contract,
                min_escrow,
            })
            .unwrap(),
        );
    }

    pub(crate) fn get() -> Option<Self> {
        env::storage_read(TOKEN_ASSET).map(|bytes| near_sdk::borsh::from_slice(&bytes).unwrap())
    }
}

pub(crate) fn require_native_asset() {
    require!(TokenAsset::get().is_none(), ERR_WRONG_FUNDING_ASSET);
}

pub(crate) fn payment(recipient: AccountId, amount: u128) -> Promise {
    match TokenAsset::get() {
        None => Promise::new(recipient).transfer(NearToken::from_yoctonear(amount)),
        Some(asset) => Promise::new(asset.token_contract).function_call(
            "ft_transfer",
            near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({
                "receiver_id": recipient,
                "amount": U128(amount),
            }))
            .unwrap(),
            NearToken::from_yoctonear(1),
            near_sdk::Gas::from_tgas(12),
        ),
    }
}

#[derive(Deserialize)]
#[serde(
    crate = "near_sdk::serde",
    tag = "operation",
    rename_all = "snake_case",
    deny_unknown_fields
)]
enum Funding {
    Create {
        task_id: String,
        manifest_hash: Hash32,
        policy: TaskPolicy,
    },
    Escrow {
        task_id: String,
    },
    Premium {
        task_id: String,
    },
    Guarantee {
        task_id: String,
        max_liability: U128,
    },
}

#[near]
impl OutcomeVault {
    pub fn get_token_asset(&self) -> Option<TokenAsset> {
        TokenAsset::get()
    }

    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> U128 {
        let asset = TokenAsset::get().unwrap_or_else(|| env::panic_str(ERR_WRONG_FUNDING_ASSET));
        require!(
            env::predecessor_account_id() == asset.token_contract,
            ERR_WRONG_TOKEN_CONTRACT
        );
        let funding = near_sdk::serde_json::from_str::<Funding>(&msg)
            .unwrap_or_else(|_| env::panic_str(ERR_INVALID_TOKEN_FUNDING));
        match funding {
            Funding::Create {
                task_id,
                manifest_hash,
                policy,
            } => self.create_funded_task(
                task_id,
                manifest_hash,
                policy,
                sender_id,
                amount.0,
                asset.min_escrow.0,
            ),
            Funding::Escrow { task_id } => {
                self.credit_owner_pool(&task_id, Pool::Escrow, sender_id, amount.0)
            }
            Funding::Premium { task_id } => {
                self.credit_owner_pool(&task_id, Pool::Premium, sender_id, amount.0)
            }
            Funding::Guarantee {
                task_id,
                max_liability,
            } => self.credit_guarantee(&task_id, sender_id, amount.0, max_liability),
        }
        U128(0)
    }
}
