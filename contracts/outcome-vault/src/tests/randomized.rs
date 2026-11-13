use super::harness::*;
use super::simulation::{Simulation, TASK};
use super::steps::anyone;
use crate::{TaskState, TransferStatus, MAX_TRANSFER_RETRIES};

const SEEDS: u64 = 200;
const STEPS: usize = 70;
const CHAOS_PERCENT: u64 = 30;

impl Simulation {
    fn chaos_step(&mut self) {
        match self.rng.below(12) {
            0 => self.step_fund(false),
            1 => self.step_fund(true),
            2 => self.step_guarantee(),
            3 => self.step_assign(),
            4 => self.step_recover(),
            5 => self.step_verdict(),
            6 => self.step_finalize(true),
            7 => self.step_finalize(false),
            8 => self.h.now += HOUR_NS / 4,
            9 => self.step_deliver(false),
            10 => self.step_deliver(true),
            _ => self.step_retry(),
        }
    }

    fn step(&mut self) {
        let Some(task) = self.h.vault.get_task(TASK.to_string()) else {
            self.step_create();
            return;
        };
        if self.rng.chance(CHAOS_PERCENT) {
            self.chaos_step();
            return;
        }
        let roll = self.rng.below(100);
        match task.state {
            TaskState::Funded => match roll {
                0..=14 => self.step_fund(true),
                15..=39 => self.step_guarantee(),
                40..=49 => self.step_fund(false),
                _ => self.step_assign(),
            },
            TaskState::Assigned => match roll {
                0..=64 => self.step_verdict(),
                65..=89 => self.step_recover(),
                _ => self.h.now += HOUR_NS / 4,
            },
            TaskState::RecoveryOpen => match roll {
                0..=74 => self.step_assign(),
                75..=89 => self.step_finalize(false),
                _ => self.h.now += HOUR_NS / 4,
            },
            TaskState::Accepted => self.step_finalize(true),
            TaskState::TerminalFailure => self.step_finalize(false),
            _ => match roll {
                0..=59 => self.step_deliver(false),
                60..=74 => self.step_deliver(true),
                _ => self.step_retry(),
            },
        }
    }

    fn drain(&mut self) {
        loop {
            if let Some(index) = self
                .dispatches
                .iter()
                .position(|dispatch| !dispatch.delivered)
            {
                self.deliver(index, true);
                continue;
            }
            let Some(task) = self.h.vault.get_task(TASK.to_string()) else {
                return;
            };
            let retryable = task.transfer_ids.iter().find(|id| {
                let transfer = self.h.transfer(id);
                transfer.status == TransferStatus::Failed && transfer.retries < MAX_TRANSFER_RETRIES
            });
            match retryable.cloned() {
                Some(transfer_id) => {
                    let keeper = self.rng.pick(&anyone());
                    let retried =
                        self.call(&keeper, 0, |h| h.vault.retry_failed_transfer(transfer_id));
                    assert!(retried, "a failed transfer under the cap must be retryable");
                }
                None => return,
            }
        }
    }

    fn assert_final(&self) {
        let Some(task) = self.h.vault.get_task(TASK.to_string()) else {
            return;
        };
        let ledger = self.h.ledger(TASK);
        assert!(ledger.is_conserved());
        let transfers = self.h.transfers(TASK);
        if task.state.is_settled() {
            assert!(transfers
                .iter()
                .all(|t| t.status == TransferStatus::Confirmed));
            assert_eq!(ledger.confirmed_outflow, ledger.total_inflow);
            assert_eq!(task.ledger_hash, Some(ledger.hash()));
        }
        if task.state == TaskState::Settled {
            let assignment = task
                .assignment
                .as_ref()
                .expect("settled success has assignment");
            let paid: u128 = assignment
                .payees
                .iter()
                .map(|(payee, _)| self.h.confirmed_to(TASK, payee))
                .sum();
            assert_eq!(paid, assignment.amount);
        }
        let pending = [
            TaskState::SettlementPending,
            TaskState::FailureSettlementPending,
        ];
        if pending.contains(&task.state) {
            assert!(transfers
                .iter()
                .any(|t| t.status == TransferStatus::Failed && t.retries == MAX_TRANSFER_RETRIES));
        }
    }
}

#[test]
fn randomized_sequences_preserve_invariants() {
    let mut outcomes = std::collections::BTreeMap::new();
    for seed in 1..=SEEDS {
        let mut simulation = Simulation::new(seed);
        for _ in 0..STEPS {
            simulation.step();
        }
        simulation.drain();
        simulation.assert_final();
        let state = simulation
            .h
            .vault
            .get_task(TASK.to_string())
            .map(|task| format!("{:?}", task.state))
            .unwrap_or_default();
        *outcomes.entry(state).or_insert(0u32) += 1;
    }
    for required in ["Settled", "FailureSettled"] {
        assert!(
            u64::from(outcomes.get(required).copied().unwrap_or(0)) >= SEEDS / 10,
            "too few random runs reached {required}: {outcomes:?}"
        );
    }
}
