import {
  failureLegs,
  isSettled,
  resolveTransfer,
  settlementKeyFor,
  successLegs,
  type Leg,
  type Ledger,
} from "@backstop/ledger";
import { digestOf, fail, fromYocto, succeed, toYocto, type Digest } from "@backstop/shared";
import type { Decision } from "./commands.js";
import type { SettlementLeg } from "./events.js";
import type { TaskRecord } from "./record.js";
import { preAcceptanceStates } from "./transitions.js";

const asEventLegs = (legs: readonly Leg[]): SettlementLeg[] =>
  legs.map(({ recipient, amount, pool, purpose }) => ({
    recipient,
    amountYocto: toYocto(amount),
    pool,
    purpose,
  }));

const plain = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  );

export function ledgerHash(ledger: Ledger): Digest {
  return digestOf(plain(ledger));
}

export function decideSettle(record: TaskRecord): Decision {
  if (record.ledger.settlementKey !== null) {
    return fail(
      "ALREADY_SETTLED",
      `Settlement ${record.ledger.settlementKey} already holds this task`,
    );
  }
  if (record.state !== "ACCEPTED" || record.assignment === null) {
    return fail("INVALID_TRANSITION", `Only an accepted task settles, not ${record.state}`);
  }
  const assignment = record.assignment;
  const legs = successLegs(record.ledger, {
    payees: assignment.bid.bid.members.map((member) => ({
      account: member.account,
      amount: fromYocto(member.shareYocto),
    })),
    primarySucceeded: assignment.epoch === 0,
  });
  if (!legs.ok) return legs;
  const scope = { taskId: record.taskId, kind: "success", attempt: assignment.attempt } as const;
  return succeed([
    {
      type: "settlement_started",
      kind: "success",
      attempt: scope.attempt,
      settlementKey: settlementKeyFor(scope),
      legs: asEventLegs(legs.value),
    },
  ]);
}

export function decideSettleFailure(record: TaskRecord): Decision {
  if (record.ledger.settlementKey !== null) {
    return fail(
      "ALREADY_SETTLED",
      `Settlement ${record.ledger.settlementKey} already holds this task`,
    );
  }
  if (record.state !== "TERMINAL_FAILURE") {
    return fail(
      "INVALID_TRANSITION",
      `Only a terminal failure settles as failed, not ${record.state}`,
    );
  }
  const cap = record.manifest.guarantee?.compensationCapYocto ?? "0";
  const legs = failureLegs(record.ledger, fromYocto(cap));
  const scope = { taskId: record.taskId, kind: "failure", attempt: record.attempt } as const;
  return succeed([
    {
      type: "settlement_started",
      kind: "failure",
      attempt: scope.attempt,
      settlementKey: settlementKeyFor(scope),
      legs: asEventLegs(legs),
    },
  ]);
}

export function decideResolveTransfer(
  record: TaskRecord,
  transferId: string,
  succeeded: boolean,
): Decision {
  const kind = record.ledger.settlementKind;
  if (kind === null) return fail("INVALID_TRANSITION", "No settlement is pending");
  const transfer = record.ledger.transfers.find((candidate) => candidate.id === transferId);
  if (transfer === undefined) return fail("NOT_FOUND", `No transfer ${transferId}`);
  if (transfer.status !== "PENDING") return succeed([]);
  const next = resolveTransfer(record.ledger, transferId, succeeded);
  if (!next.ok) return next;
  return succeed([
    { type: "transfer_resolved", transferId, succeeded },
    ...(isSettled(next.value)
      ? [{ type: "task_settled" as const, kind, ledgerHash: ledgerHash(next.value) }]
      : []),
  ]);
}

export function decideRetryTransfer(record: TaskRecord, transferId: string): Decision {
  const transfer = record.ledger.transfers.find((candidate) => candidate.id === transferId);
  if (transfer === undefined) return fail("NOT_FOUND", `No transfer ${transferId}`);
  if (transfer.status !== "FAILED") {
    return fail("TRANSFER_NOT_RETRYABLE", `Transfer ${transferId} is ${transfer.status}`);
  }
  return succeed([{ type: "transfer_retried", transferId }]);
}

export function decideExpireDeadline(record: TaskRecord, nowMs: number): Decision {
  if (!preAcceptanceStates.includes(record.state)) {
    return fail("INVALID_TRANSITION", `The deadline no longer applies in ${record.state}`);
  }
  if (nowMs <= record.manifest.deadlineMs)
    return fail("POLICY_VIOLATION", "The deadline has not passed");
  return succeed([{ type: "terminal_failure", reason: "DEADLINE_PASSED" }]);
}
