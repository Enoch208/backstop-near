import type {
  Checkpoint,
  Digest,
  Endorsement,
  EvidenceBundle,
  Outcome,
  SignedBid,
  SignedChallengeRuling,
  TaskManifest,
} from "@backstop/shared";
import type { TaskEventBody } from "./events.js";

export type Command =
  | { kind: "create"; manifest: TaskManifest }
  | { kind: "deposit"; pool: "escrow" | "premium"; amount: bigint; reference: string }
  | { kind: "postGuarantee"; guarantor: string; bond: bigint; liability: bigint; reference: string }
  | { kind: "assignPrimary"; bid: SignedBid }
  | { kind: "claim"; agentId: string }
  | { kind: "heartbeat"; agentId: string; fencingToken: number }
  | { kind: "checkpoint"; agentId: string; fencingToken: number; checkpoint: Checkpoint }
  | {
      kind: "submit";
      agentId: string;
      fencingToken: number;
      artifactHash: Digest;
      checkpointHash: Digest | null;
    }
  | {
      kind: "recordFinding";
      agentId: string;
      attempt: number;
      findingHash: Digest;
      failingCases: readonly string[];
    }
  | { kind: "expireLease" }
  | { kind: "bid"; bid: SignedBid }
  | { kind: "endorse"; bidHash: Digest; endorsement: Endorsement }
  | { kind: "closeAuction" }
  | { kind: "recordVerification"; evidence: EvidenceBundle }
  | { kind: "challenge"; signed: SignedChallengeRuling }
  | { kind: "closeChallengeWindow" }
  | { kind: "expireDeadline" }
  | { kind: "settle" }
  | { kind: "settleFailure" }
  | { kind: "resolveTransfer"; transferId: string; succeeded: boolean }
  | { kind: "retryTransfer"; transferId: string };

export type CommandKind = Command["kind"];

export type Registry = {
  readonly agentKeys: Readonly<Record<string, string>>;
  readonly verifierPublicKey: string;
};

export type DecisionContext = { readonly nowMs: number; readonly registry: Registry };

export type Decision = Outcome<TaskEventBody[]>;
