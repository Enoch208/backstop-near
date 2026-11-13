use std::collections::BTreeMap;
use std::panic::{catch_unwind, AssertUnwindSafe};

use near_sdk::AccountId;

use super::harness::*;
use crate::{Hash32, LedgerView, Task, TaskPolicy, TaskState, Transfer, TransferStatus};

pub const TASK: &str = "fuzz";

pub struct Rng(u64);

impl Rng {
    pub fn seeded(seed: u64) -> Self {
        Self(seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1)
    }

    pub fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    pub fn below(&mut self, bound: u64) -> u64 {
        self.next() % bound
    }

    pub fn chance(&mut self, percent: u64) -> bool {
        self.below(100) < percent
    }

    pub fn pick<T: Clone>(&mut self, items: &[T]) -> T {
        items[self.below(items.len() as u64) as usize].clone()
    }
}

#[derive(Clone, Debug, PartialEq)]
struct Snapshot {
    task: Option<Task>,
    ledger: Option<LedgerView>,
    transfers: Vec<Transfer>,
}

pub struct Dispatch {
    pub transfer_id: String,
    pub retry: u32,
    pub delivered: bool,
}

pub struct Simulation {
    pub h: Harness,
    pub rng: Rng,
    pub dispatches: Vec<Dispatch>,
    pub paid: BTreeMap<String, u32>,
    pub created: Option<(Hash32, TaskPolicy)>,
}

impl Simulation {
    pub fn new(seed: u64) -> Self {
        Self {
            h: Harness::new(),
            rng: Rng::seeded(seed),
            dispatches: Vec::new(),
            paid: BTreeMap::new(),
            created: None,
        }
    }

    fn snapshot(&self) -> Snapshot {
        let task = self.h.vault.get_task(TASK.to_string());
        let transfers = task
            .as_ref()
            .map(|task| self.h.transfers(&task.task_id))
            .unwrap_or_default();
        Snapshot {
            ledger: self.h.vault.get_ledger(TASK.to_string()),
            task,
            transfers,
        }
    }

    pub fn call(
        &mut self,
        caller: &AccountId,
        deposit: u128,
        action: impl FnOnce(&mut Harness),
    ) -> bool {
        let before = self.snapshot();
        self.h.act(caller, deposit);
        let outcome = catch_unwind(AssertUnwindSafe(|| action(&mut self.h)));
        self.observe(before, outcome.is_ok())
    }

    pub fn deliver(&mut self, index: usize, succeeded: bool) {
        let before = self.snapshot();
        let (transfer_id, retry, replay) = {
            let dispatch = &mut self.dispatches[index];
            let replay = dispatch.delivered;
            dispatch.delivered = true;
            (dispatch.transfer_id.clone(), dispatch.retry, replay)
        };
        if succeeded && !replay {
            *self.paid.entry(transfer_id.clone()).or_insert(0) += 1;
        }
        self.h.deliver(&transfer_id, retry, succeeded);
        let after = self.snapshot();
        if replay {
            assert_eq!(after, before, "replayed callback mutated state");
        }
        self.observe(before, true);
    }

    fn observe(&mut self, before: Snapshot, succeeded: bool) -> bool {
        let after = self.snapshot();
        if !succeeded {
            assert_eq!(after, before, "rejected call mutated state");
            return false;
        }
        let version = |snapshot: &Snapshot| snapshot.task.as_ref().map(|task| task.state_version);
        match (version(&before), version(&after)) {
            (Some(old), Some(new)) if old == new => assert_eq!(after, before, "silent mutation"),
            (Some(old), Some(new)) => assert_eq!(new, old + 1, "one bump per call"),
            _ => {}
        }
        for event in events()
            .iter()
            .filter(|event| event["event"] == "transfer_scheduled")
        {
            let data = &event["data"][0];
            self.dispatches.push(Dispatch {
                transfer_id: data["transfer_id"].as_str().unwrap_or_default().to_string(),
                retry: data["retry"].as_u64().unwrap_or_default() as u32,
                delivered: false,
            });
        }
        self.check_invariants(&before, &after);
        true
    }

    fn check_invariants(&mut self, before: &Snapshot, after: &Snapshot) {
        let Some(task) = after.task.as_ref() else {
            return;
        };
        let created = self
            .created
            .get_or_insert_with(|| (task.manifest_hash, task.policy.clone()));
        assert_eq!((task.manifest_hash, task.policy.clone()), created.clone());
        self.h.assert_invariants(TASK);
        for old in before
            .transfers
            .iter()
            .filter(|t| t.status == TransferStatus::Confirmed)
        {
            assert_eq!(&self.h.transfer(&old.id), old, "confirmed transfer changed");
        }
        let mut in_flight = BTreeMap::new();
        for dispatch in self
            .dispatches
            .iter()
            .filter(|dispatch| !dispatch.delivered)
        {
            *in_flight.entry(dispatch.transfer_id.clone()).or_insert(0) += 1;
        }
        assert!(
            in_flight.values().all(|count| *count == 1),
            "duplicate in-flight dispatch"
        );
        assert!(
            self.paid.values().all(|count| *count <= 1),
            "recipient paid twice"
        );
        for (id, _) in self.paid.iter() {
            assert_eq!(self.h.transfer(id).status, TransferStatus::Confirmed);
        }
        let mut moved: BTreeMap<AccountId, u128> = BTreeMap::new();
        for id in self.paid.keys() {
            let transfer = self.h.transfer(id);
            *moved.entry(transfer.recipient).or_insert(0) += transfer.amount;
        }
        let booked: BTreeMap<AccountId, u128> = self
            .h
            .ledger(TASK)
            .confirmed_by_recipient
            .into_iter()
            .map(|total| (total.recipient, total.amount))
            .collect();
        assert_eq!(moved, booked, "confirmed ledger differs from money moved");
        let success_states = [TaskState::SettlementPending, TaskState::Settled];
        let previous = before.task.as_ref().map(|old| old.state);
        let entered_success = success_states.contains(&task.state)
            && previous.is_some_and(|state| !success_states.contains(&state));
        if entered_success {
            let accepted = before.task.as_ref().is_some_and(|old| {
                old.state == TaskState::Accepted
                    && old.verdict.as_ref().is_some_and(|verdict| {
                        verdict.attempt == old.current_attempt
                            && verdict.outcome == crate::VerdictOutcome::Accept
                    })
            });
            assert!(accepted, "success settlement without accepted verdict");
        }
    }
}
