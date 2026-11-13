use near_sdk::json_types::U128;
use near_sdk::AccountId;

use super::harness::*;
use super::simulation::{Simulation, TASK};
use crate::{TaskPolicy, VerdictOutcome};

pub fn anyone() -> Vec<AccountId> {
    vec![
        customer(),
        guarantor(),
        stranger(),
        coordinator(),
        verifier(),
        agent("a"),
    ]
}

impl Simulation {
    pub fn caller(&mut self, expected: AccountId) -> AccountId {
        if self.rng.chance(85) {
            expected
        } else {
            self.rng.pick(&anyone())
        }
    }

    pub fn amount(&mut self, max_milli: u64) -> u128 {
        milli(self.rng.below(max_milli + 1) as u128)
    }

    pub fn current_attempt(&self) -> u32 {
        self.h
            .vault
            .get_task(TASK.to_string())
            .map(|task| task.current_attempt)
            .unwrap_or(0)
    }

    pub fn step_create(&mut self) {
        let escrow = self.amount(800);
        let policy = TaskPolicy {
            deadline_ns: self.h.now + HOUR_NS,
            max_attempts: 1 + self.rng.below(4) as u32,
            compensation_cap: self.amount(300),
            min_bond: 0,
            min_liability: 0,
        };
        self.call(&customer(), escrow, |h| {
            h.vault.create_task(TASK.to_string(), hash(1), policy)
        });
    }

    pub fn step_fund(&mut self, premium: bool) {
        let caller = self.caller(customer());
        let deposit = self.amount(80);
        self.call(&caller, deposit, |h| {
            if premium {
                h.vault.fund_premium(TASK.to_string())
            } else {
                h.vault.fund_task(TASK.to_string())
            }
        });
    }

    pub fn step_guarantee(&mut self) {
        let non_payees = [customer(), stranger(), coordinator(), verifier()];
        let caller = if self.rng.chance(85) {
            guarantor()
        } else {
            self.rng.pick(&non_payees)
        };
        let bond = self.amount(400);
        let liability = self.amount(450);
        self.call(&caller, bond, |h| {
            h.vault.post_guarantee(TASK.to_string(), U128(liability))
        });
    }

    pub fn step_assign(&mut self) {
        let caller = self.caller(coordinator());
        let next = self.current_attempt() + 1;
        let attempt = if self.rng.chance(85) {
            next
        } else {
            self.rng.below(next as u64 + 2) as u32
        };
        let count = 1 + self.rng.below(3) as usize;
        let names = ["a", "b", "c", "d", "e"];
        let entries: Vec<(AccountId, u128)> = (0..count)
            .map(|_| {
                (
                    agent(self.rng.pick(&names)),
                    milli(1 + self.rng.below(350) as u128),
                )
            })
            .collect();
        let mut amount: u128 = entries.iter().map(|(_, share)| share).sum();
        if self.rng.chance(10) {
            amount += 1;
        }
        let bid = hash(attempt as u8);
        self.call(&caller, 0, |h| {
            h.vault.register_assignment(
                TASK.to_string(),
                attempt,
                entries[0].0.clone(),
                bid,
                U128(amount),
                payees(&entries),
            )
        });
    }

    pub fn step_recover(&mut self) {
        let caller = self.caller(coordinator());
        self.call(&caller, 0, |h| {
            h.vault
                .open_recovery(TASK.to_string(), "LEASE_EXPIRED".to_string())
        });
    }

    pub fn step_verdict(&mut self) {
        let caller = self.caller(verifier());
        let current = self.current_attempt();
        let attempt = if self.rng.chance(85) {
            current
        } else {
            self.rng.below(current as u64 + 2) as u32
        };
        let outcome = if self.rng.chance(55) {
            VerdictOutcome::Accept
        } else {
            VerdictOutcome::Reject
        };
        self.call(&caller, 0, |h| {
            h.vault.record_verdict(
                TASK.to_string(),
                attempt,
                hash(10),
                hash(11),
                hash(12),
                outcome,
            )
        });
    }

    pub fn step_finalize(&mut self, success: bool) {
        let expected = if self.rng.chance(50) {
            coordinator()
        } else {
            customer()
        };
        let caller = self.caller(expected);
        self.call(&caller, 0, |h| {
            if success {
                h.vault.finalize_success(TASK.to_string())
            } else {
                h.vault.finalize_failure(TASK.to_string())
            }
        });
    }

    pub fn step_deliver(&mut self, replay: bool) {
        let candidates: Vec<usize> = (0..self.dispatches.len())
            .filter(|index| self.dispatches[*index].delivered == replay)
            .collect();
        if candidates.is_empty() {
            return;
        }
        let index = self.rng.pick(&candidates);
        let succeeded = self.rng.chance(70);
        self.deliver(index, succeeded);
    }

    pub fn step_retry(&mut self) {
        let Some(task) = self.h.vault.get_task(TASK.to_string()) else {
            return;
        };
        if task.transfer_ids.is_empty() {
            return;
        }
        let transfer_id = self.rng.pick(&task.transfer_ids);
        let caller = self.rng.pick(&anyone());
        self.call(&caller, 0, |h| h.vault.retry_failed_transfer(transfer_id));
    }
}
