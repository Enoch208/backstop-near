use near_sdk::{env, near, require, AccountId};

use crate::errors::{
    ERR_NOT_COORDINATOR, ERR_NOT_OWNER, ERR_NOT_VERIFIER, ERR_ROLE_CONFLICT, ERR_UNAUTHORIZED,
};
use crate::events;
use crate::task::Task;
use crate::{OutcomeVault, OutcomeVaultExt};

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Roles {
    pub owner: AccountId,
    pub coordinator: AccountId,
    pub verifier: AccountId,
}

pub fn require_distinct_roles(coordinator: &AccountId, verifier: &AccountId) {
    require!(coordinator != verifier, ERR_ROLE_CONFLICT);
}

#[near]
impl OutcomeVault {
    pub fn set_roles(&mut self, coordinator: AccountId, verifier: AccountId) {
        self.require_owner();
        require_distinct_roles(&coordinator, &verifier);
        self.coordinator = coordinator;
        self.verifier = verifier;
        events::roles_updated(&self.roles());
    }
}

impl OutcomeVault {
    pub(crate) fn roles(&self) -> Roles {
        Roles {
            owner: self.owner.clone(),
            coordinator: self.coordinator.clone(),
            verifier: self.verifier.clone(),
        }
    }

    pub(crate) fn require_owner(&self) {
        require!(env::predecessor_account_id() == self.owner, ERR_NOT_OWNER);
    }

    pub(crate) fn require_coordinator(&self) {
        require!(
            env::predecessor_account_id() == self.coordinator,
            ERR_NOT_COORDINATOR
        );
    }

    pub(crate) fn require_verifier(&self) {
        require!(
            env::predecessor_account_id() == self.verifier,
            ERR_NOT_VERIFIER
        );
    }

    pub(crate) fn require_settler(&self, task: &Task) {
        let caller = env::predecessor_account_id();
        require!(
            caller == self.coordinator || caller == task.owner,
            ERR_UNAUTHORIZED
        );
    }
}
