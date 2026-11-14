import type {
  ChallengeRuling,
  Checkpoint,
  Digest,
  Endorsement,
  EvidenceBundle,
  FailureReason,
  Lease,
  SignedBid,
  TaskManifest,
  YoctoString,
} from "@backstop/shared";
import type { Pool, TransferPurpose } from "@backstop/ledger";

export type RejectedBid = { readonly bidHash: Digest; readonly reason: string };

export type SettlementLeg = {
  readonly recipient: string;
  readonly amountYocto: YoctoString;
  readonly pool: Pool;
  readonly purpose: TransferPurpose;
};

export type TaskEventBody =
  | { type: "task_created"; manifest: TaskManifest; manifestHash: Digest }
  | {
      type: "funds_deposited";
      pool: "escrow" | "premium";
      amountYocto: YoctoString;
      reference: string;
    }
  | {
      type: "guarantee_posted";
      guarantor: string;
      bondYocto: YoctoString;
      liabilityYocto: YoctoString;
      reference: string;
    }
  | { type: "attempt_assigned"; attempt: number; epoch: number; bid: SignedBid; claimByMs: number }
  | { type: "lease_granted"; lease: Lease }
  | { type: "heartbeat_recorded"; fencingToken: number; expiresAtMs: number }
  | { type: "checkpoint_recorded"; checkpoint: Checkpoint; checkpointHash: Digest }
  | {
      type: "artifact_submitted";
      attempt: number;
      fencingToken: number;
      agentId: string;
      artifactHash: Digest;
      checkpointHash: Digest | null;
    }
  | { type: "lease_expired"; attempt: number; fencingToken: number | null }
  | { type: "attempt_failed"; attempt: number; reason: FailureReason; agents: readonly string[] }
  | { type: "recovery_opened"; epoch: number; reason: FailureReason; closesAtMs: number }
  | { type: "coalition_proposed"; bid: SignedBid }
  | { type: "coalition_endorsed"; bidHash: Digest; endorsement: Endorsement }
  | { type: "bid_submitted"; bid: SignedBid }
  | { type: "recovery_awarded"; epoch: number; winner: Digest; rejected: readonly RejectedBid[] }
  | {
      type: "verification_recorded";
      evidence: EvidenceBundle;
      challengeDeadlineMs: number | null;
    }
  | { type: "challenge_dismissed"; ruling: ChallengeRuling }
  | {
      type: "attempt_rejected";
      attempt: number;
      reason: FailureReason;
      ruling: ChallengeRuling | null;
      agents: readonly string[];
    }
  | { type: "task_accepted"; attempt: number; evidenceHash: Digest }
  | { type: "terminal_failure"; reason: FailureReason }
  | {
      type: "settlement_started";
      kind: "success" | "failure";
      attempt: number;
      settlementKey: Digest;
      legs: readonly SettlementLeg[];
    }
  | { type: "transfer_resolved"; transferId: string; succeeded: boolean }
  | { type: "transfer_retried"; transferId: string }
  | { type: "task_settled"; kind: "success" | "failure"; ledgerHash: Digest };

export type TaskEventType = TaskEventBody["type"];

export type TaskEvent = {
  readonly eventId: string;
  readonly taskId: string;
  readonly version: number;
  readonly atMs: number;
  readonly actor: string;
  readonly body: TaskEventBody;
};
