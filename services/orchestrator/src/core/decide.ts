import { fail } from "@backstop/shared";
import type { Command, Decision, DecisionContext } from "./commands.js";
import {
  decideAssignPrimary,
  decideCreate,
  decideDeposit,
  decideGuarantee,
} from "./decide-funding.js";
import { decideBid, decideCloseAuction } from "./decide-market.js";
import {
  decideExpireDeadline,
  decideResolveTransfer,
  decideRetryTransfer,
  decideSettle,
  decideSettleFailure,
} from "./decide-settlement.js";
import {
  decideChallenge,
  decideCloseChallengeWindow,
  decideVerification,
} from "./decide-verdict.js";
import {
  decideCheckpoint,
  decideClaim,
  decideExpireLease,
  decideHeartbeat,
  decideSubmit,
} from "./decide-work.js";
import type { TaskRecord } from "./record.js";

export function decide(
  record: TaskRecord | null,
  command: Command,
  context: DecisionContext,
): Decision {
  if (command.kind === "create") return decideCreate(record, command.manifest);
  if (record === null) return fail("NOT_FOUND", "The task does not exist");
  const now = context.nowMs;
  switch (command.kind) {
    case "deposit":
      return decideDeposit(record, command.pool, command.amount, command.reference);
    case "postGuarantee":
      return decideGuarantee(
        record,
        command.guarantor,
        command.bond,
        command.liability,
        command.reference,
      );
    case "assignPrimary":
      return decideAssignPrimary(record, command.bid, context);
    case "claim":
      return decideClaim(record, command.agentId, context);
    case "heartbeat":
      return decideHeartbeat(record, command.agentId, command.fencingToken, context);
    case "checkpoint":
      return decideCheckpoint(
        record,
        command.agentId,
        command.fencingToken,
        command.checkpoint,
        context,
      );
    case "submit":
      return decideSubmit(
        record,
        command.agentId,
        command.fencingToken,
        command.artifactHash,
        command.checkpointHash,
        context,
      );
    case "expireLease":
      return decideExpireLease(record, context);
    case "bid":
      return decideBid(record, command.bid, context);
    case "closeAuction":
      return decideCloseAuction(record, context);
    case "recordVerification":
      return decideVerification(record, command.evidence, context);
    case "challenge":
      return decideChallenge(record, command.signed, context);
    case "closeChallengeWindow":
      return decideCloseChallengeWindow(record, context);
    case "expireDeadline":
      return decideExpireDeadline(record, now);
    case "settle":
      return decideSettle(record);
    case "settleFailure":
      return decideSettleFailure(record);
    case "resolveTransfer":
      return decideResolveTransfer(record, command.transferId, command.succeeded);
    case "retryTransfer":
      return decideRetryTransfer(record, command.transferId);
  }
}
