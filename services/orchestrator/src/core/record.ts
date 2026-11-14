import { openLedger, type Ledger } from "@backstop/ledger";
import type {
  Checkpoint,
  Digest,
  EvidenceBundle,
  FailureReason,
  Lease,
  SignedBid,
  TaskManifest,
  TaskState,
} from "@backstop/shared";

export type Assignment = {
  readonly attempt: number;
  readonly epoch: number;
  readonly bid: SignedBid;
  readonly claimByMs: number;
};

export type Candidate = {
  readonly attempt: number;
  readonly fencingToken: number;
  readonly agentId: string;
  readonly artifactHash: Digest;
  readonly checkpointHash: Digest | null;
  readonly evidence: EvidenceBundle | null;
  readonly challengeDeadlineMs: number | null;
};

export type Auction = {
  readonly epoch: number;
  readonly closesAtMs: number;
  readonly bids: readonly SignedBid[];
  readonly proposals: readonly SignedBid[];
};

export type TaskRecord = {
  readonly taskId: string;
  readonly manifest: TaskManifest;
  readonly manifestHash: Digest;
  readonly state: TaskState;
  readonly version: number;
  readonly attempt: number;
  readonly epoch: number;
  readonly fencingToken: number;
  readonly assignment: Assignment | null;
  readonly lease: Lease | null;
  readonly checkpoints: readonly { checkpoint: Checkpoint; hash: Digest }[];
  readonly auction: Auction | null;
  readonly candidate: Candidate | null;
  readonly excludedAgents: readonly string[];
  readonly failures: readonly { attempt: number; reason: FailureReason }[];
  readonly ledger: Ledger;
};

export function newRecord(manifest: TaskManifest, manifestHash: Digest): TaskRecord {
  return {
    taskId: manifest.taskId,
    manifest,
    manifestHash,
    state: "DRAFT",
    version: 0,
    attempt: 0,
    epoch: 0,
    fencingToken: 0,
    assignment: null,
    lease: null,
    checkpoints: [],
    auction: null,
    candidate: null,
    excludedAgents: [],
    failures: [],
    ledger: openLedger(manifest.owner),
  };
}

export function lastCheckpointHash(record: TaskRecord): Digest | null {
  return record.checkpoints.at(-1)?.hash ?? null;
}
