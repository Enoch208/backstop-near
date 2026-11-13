use near_sdk::{require, AccountId};

use crate::errors::ERR_LIABILITY_EXCEEDED;
use crate::math::sub;
use crate::model::{Assignment, Pool};
use crate::task::Task;

pub const FAILURE_LABEL: &str = "f";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Leg {
    pub recipient: AccountId,
    pub amount: u128,
    pub pool: Pool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PayoutPlan {
    pub label: String,
    pub legs: Vec<Leg>,
    pub bond_spent: u128,
}

impl PayoutPlan {
    fn new(label: String, bond_spent: u128) -> Self {
        Self {
            label,
            legs: Vec::new(),
            bond_spent,
        }
    }

    fn pay(&mut self, recipient: &AccountId, amount: u128, pool: Pool) {
        if amount > 0 {
            self.legs.push(Leg {
                recipient: recipient.clone(),
                amount,
                pool,
            });
        }
    }
}

pub fn success_plan(task: &Task, assignment: &Assignment) -> PayoutPlan {
    let from_escrow = assignment.amount.min(task.escrow_available);
    let from_bond = sub(assignment.amount, from_escrow);
    require!(from_bond <= task.bond_headroom(), ERR_LIABILITY_EXCEEDED);
    let mut plan = PayoutPlan::new(assignment.attempt.to_string(), from_bond);
    let mut escrow_left = from_escrow;
    for (payee, share) in &assignment.payees {
        let escrow_part = (*share).min(escrow_left);
        escrow_left = sub(escrow_left, escrow_part);
        plan.pay(payee, escrow_part, Pool::Escrow);
        plan.pay(payee, sub(*share, escrow_part), Pool::Bond);
    }
    let customer = &task.owner;
    let premium_recipient = match &task.guarantor {
        Some(guarantor) if assignment.attempt == 1 => guarantor,
        _ => customer,
    };
    plan.pay(
        customer,
        sub(task.escrow_available, from_escrow),
        Pool::Escrow,
    );
    plan.pay(premium_recipient, task.premium_available, Pool::Premium);
    if let Some(guarantor) = &task.guarantor {
        plan.pay(guarantor, sub(task.bond_available, from_bond), Pool::Bond);
    }
    plan
}

pub fn failure_plan(task: &Task) -> PayoutPlan {
    let compensation = task.bond_headroom().min(task.policy.compensation_cap);
    let mut plan = PayoutPlan::new(FAILURE_LABEL.to_string(), compensation);
    let customer = &task.owner;
    plan.pay(customer, task.escrow_available, Pool::Escrow);
    plan.pay(customer, compensation, Pool::Bond);
    plan.pay(customer, task.premium_available, Pool::Premium);
    if let Some(guarantor) = &task.guarantor {
        plan.pay(
            guarantor,
            sub(task.bond_available, compensation),
            Pool::Bond,
        );
    }
    plan
}
