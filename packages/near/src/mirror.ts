import { endorseBid, roster, rosterAgent, signBid } from "@backstop/agents";
import type { TaskEventBody, TaskRecord } from "@backstop/orchestrator";
import {
  digestOf,
  fromYocto,
  leadAgent,
  type EvidenceBundle,
  type SignedBid,
} from "@backstop/shared";
import type { Account } from "near-api-js";
import type { ChainCall } from "./outcome.js";
import {
  callVault,
  createTask,
  finalizeFailure,
  finalizeSuccess,
  fundPremium,
  openRecovery,
  postGuarantee,
  recordVerdict,
  registerAssignment,
  retryFailedTransfer,
  type Vault,
} from "./vault.js";
import { recordAttestedVerdict } from "./tee.js";
import { toHex32 } from "./wire.js";

export type ChainParties = {
  readonly vault: Vault;
  readonly customer: Account;
  readonly guarantor: Account;
  readonly coordinator: Account;
  readonly verifier: Account;
  readonly payoutAccount: (agentId: string) => string;
};

export type ChainStep = {
  readonly label: string;
  readonly call: ChainCall;
  readonly refusalExpected: boolean;
};

export type Rebid = {
  readonly attempt: number;
  readonly offchainBidHash: string;
  readonly chainBidHash: string;
};

const step = async (
  label: string,
  pending: Promise<ChainCall>,
  refusalExpected = false,
): Promise<ChainStep> => ({
  label,
  call: await pending,
  refusalExpected,
});

export function reissue(signed: SignedBid, payoutAccount: (agentId: string) => string): SignedBid {
  const fixture = signed.bid.members.every((member) =>
    Object.values(roster).some(
      (agent) => agent.agentId === member.agentId && agent.account === member.account,
    ),
  );
  if (!fixture) return signed;
  const members = signed.bid.members.map((member) => ({
    ...member,
    account: payoutAccount(member.agentId),
  }));
  const proposal = signBid({ ...signed.bid, members }, rosterAgent(leadAgent(signed.bid)));
  return signed.endorsements.reduce(
    (endorsed, { agentId }) => endorseBid(endorsed, rosterAgent(agentId)),
    proposal,
  );
}

export function chainDeposit(
  parties: ChainParties,
  record: TaskRecord,
  pool: "escrow" | "premium",
  amount: bigint,
  createsTask: boolean,
): Promise<ChainStep> {
  if (pool === "premium") {
    return step(
      "Customer pays the premium",
      fundPremium(parties.vault, parties.customer, record.taskId, amount),
    );
  }
  if (!createsTask) {
    return step(
      "Customer adds escrow",
      callVault(
        parties.vault,
        parties.customer,
        "fund_task",
        { task_id: record.taskId },
        { deposit: amount },
      ),
    );
  }
  const policy = {
    deadlineNs: BigInt(record.manifest.deadlineMs) * 1_000_000n,
    maxAttempts: record.manifest.policy.maxAttempts,
    compensationCap: fromYocto(record.manifest.guarantee?.compensationCapYocto ?? "0"),
  };
  return step(
    "Customer creates the task and escrows",
    createTask(
      parties.vault,
      parties.customer,
      record.taskId,
      toHex32(record.manifestHash),
      policy,
      amount,
    ),
  );
}

export function chainGuarantee(
  parties: ChainParties,
  record: TaskRecord,
  bond: bigint,
  liability: bigint,
): Promise<ChainStep> {
  return step(
    "Guarantor bonds the outcome",
    postGuarantee(parties.vault, parties.guarantor, record.taskId, bond, liability),
  );
}

export type MirrorOptions = {
  readonly fundingFromEvents: boolean;
  readonly repeatSettlement: boolean;
};

export type ChainMirror = {
  readonly apply: (record: TaskRecord, body: TaskEventBody) => Promise<ChainStep[]>;
  readonly rebids: Rebid[];
};

export function chainMirror(parties: ChainParties, options: MirrorOptions): ChainMirror {
  const created = new Set<string>();
  const evidence = new Map<string, EvidenceBundle>();
  const rebids: Rebid[] = [];

  const settle = async (record: TaskRecord, kind: "success" | "failure"): Promise<ChainStep[]> => {
    const finalize = kind === "success" ? finalizeSuccess : finalizeFailure;
    const done = await step(
      `Coordinator finalizes the ${kind} settlement`,
      finalize(parties.vault, parties.coordinator, record.taskId),
    );
    if (!options.repeatSettlement) return [done];
    return [
      done,
      await step(
        "A repeated settlement is refused",
        finalize(parties.vault, parties.coordinator, record.taskId),
        true,
      ),
    ];
  };

  const apply = async (record: TaskRecord, body: TaskEventBody): Promise<ChainStep[]> => {
    const taskId = record.taskId;
    switch (body.type) {
      case "funds_deposited": {
        if (!options.fundingFromEvents) return [];
        const createsTask = body.pool === "escrow" && !created.has(taskId);
        if (createsTask) created.add(taskId);
        return [
          await chainDeposit(parties, record, body.pool, fromYocto(body.amountYocto), createsTask),
        ];
      }
      case "guarantee_posted":
        if (!options.fundingFromEvents) return [];
        return [
          await chainGuarantee(
            parties,
            record,
            fromYocto(body.bondYocto),
            fromYocto(body.liabilityYocto),
          ),
        ];
      case "attempt_assigned": {
        const chainBid = reissue(body.bid, parties.payoutAccount);
        const [lead] = chainBid.bid.members;
        if (lead === undefined) throw new Error("An assignment has no lead payee");
        rebids.push({
          attempt: body.attempt,
          offchainBidHash: body.bid.bidHash,
          chainBidHash: chainBid.bidHash,
        });
        const payees = chainBid.bid.members.map((member) => ({
          account: member.account,
          amount: fromYocto(member.shareYocto),
        }));
        return [
          await step(
            `Coordinator commits attempt ${String(body.attempt)} to ${leadAgent(chainBid.bid)}`,
            registerAssignment(parties.vault, parties.coordinator, taskId, {
              attempt: body.attempt,
              agent: lead.account,
              bidHash: toHex32(chainBid.bidHash),
              payees,
            }),
          ),
        ];
      }
      case "attempt_failed":
        return [
          await step(
            `Coordinator opens recovery after attempt ${String(body.attempt)} (${body.reason})`,
            openRecovery(parties.vault, parties.coordinator, taskId, body.reason),
          ),
        ];
      case "verification_recorded":
        evidence.set(`${taskId}:${String(body.evidence.body.attempt)}`, body.evidence);
        return [];
      case "attempt_rejected":
      case "task_accepted": {
        const bundle = evidence.get(`${taskId}:${String(body.attempt)}`);
        if (bundle === undefined)
          throw new Error(`No evidence for attempt ${String(body.attempt)}`);
        const rejected = body.type === "attempt_rejected";
        const evidenceHash =
          rejected && body.ruling !== null ? digestOf(body.ruling) : bundle.evidenceHash;
        const verdict = {
          attempt: body.attempt,
          artifactHash: toHex32(bundle.body.artifactHash),
          suiteHash: toHex32(record.manifest.suite.suiteHash),
          evidenceHash: toHex32(evidenceHash),
        };
        const inference = rejected ? undefined : bundle.body.inference;
        if (inference !== undefined) {
          return [
            await step(
              `Verifier records ACCEPT for attempt ${String(body.attempt)}; the vault checks the TEE signature of ${inference.model}`,
              recordAttestedVerdict(parties.vault, parties.verifier, taskId, {
                ...verdict,
                signedText: inference.signedText,
                signature: inference.signature,
              }),
            ),
          ];
        }
        return [
          await step(
            `Verifier records ${rejected ? "REJECT" : "ACCEPT"} for attempt ${String(body.attempt)}`,
            recordVerdict(parties.vault, parties.verifier, taskId, {
              ...verdict,
              outcome: rejected ? "REJECT" : "ACCEPT",
            }),
          ),
        ];
      }
      case "settlement_started":
        return settle(record, body.kind);
      case "transfer_retried":
        return [
          await step(
            `Keeper retries ${body.transferId}`,
            retryFailedTransfer(parties.vault, parties.coordinator, body.transferId),
          ),
        ];
      default:
        return [];
    }
  };

  return { apply, rebids };
}
