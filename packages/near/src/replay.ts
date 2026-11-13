import { roster, signBid } from "@backstop/agents";
import type { Episode, TaskEventBody } from "@backstop/orchestrator";
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
  createTask,
  finalizeFailure,
  finalizeSuccess,
  fundPremium,
  openRecovery,
  postGuarantee,
  recordVerdict,
  registerAssignment,
  callVault,
  type Vault,
} from "./vault.js";
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

export type ChainRun = {
  readonly taskId: string;
  readonly steps: readonly ChainStep[];
  readonly rebids: readonly Rebid[];
};

function reissue(signed: SignedBid, payoutAccount: (agentId: string) => string): SignedBid {
  const lead = Object.values(roster).find((agent) => agent.agentId === leadAgent(signed.bid));
  if (lead === undefined) throw new Error(`No key for ${leadAgent(signed.bid)}`);
  const members = signed.bid.members.map((member) => ({
    ...member,
    account: payoutAccount(member.agentId),
  }));
  return signBid({ ...signed.bid, members }, lead);
}

export async function replayOnChain(parties: ChainParties, episode: Episode): Promise<ChainRun> {
  const { record } = episode;
  const taskId = record.taskId;
  const manifest = record.manifest;
  const suiteHash = toHex32(manifest.suite.suiteHash);
  const steps: ChainStep[] = [];
  const rebids: Rebid[] = [];
  const evidenceByAttempt = new Map<number, EvidenceBundle>();
  let created = false;

  const step = async (label: string, pending: Promise<ChainCall>, refusalExpected = false) => {
    const call = await pending;
    steps.push({ label, call, refusalExpected });
    if (call.ok === refusalExpected) {
      throw new Error(
        `${label}: expected ${refusalExpected ? "a refusal" : "success"}, got ${call.errorCode ?? "success"} (${call.txHash})`,
      );
    }
  };

  const apply = async (body: TaskEventBody) => {
    if (body.type === "funds_deposited" && body.pool === "escrow" && !created) {
      created = true;
      const policy = {
        deadlineNs: BigInt(manifest.deadlineMs) * 1_000_000n,
        maxAttempts: manifest.policy.maxAttempts,
        compensationCap: fromYocto(manifest.guarantee?.compensationCapYocto ?? "0"),
      };
      await step(
        "Customer creates the task and escrows",
        createTask(
          parties.vault,
          parties.customer,
          taskId,
          toHex32(record.manifestHash),
          policy,
          fromYocto(body.amountYocto),
        ),
      );
    } else if (body.type === "funds_deposited" && body.pool === "escrow") {
      await step(
        "Customer adds escrow",
        callVault(
          parties.vault,
          parties.customer,
          "fund_task",
          { task_id: taskId },
          { deposit: fromYocto(body.amountYocto) },
        ),
      );
    } else if (body.type === "funds_deposited") {
      await step(
        "Customer pays the premium",
        fundPremium(parties.vault, parties.customer, taskId, fromYocto(body.amountYocto)),
      );
    } else if (body.type === "guarantee_posted") {
      await step(
        "Guarantor bonds the outcome",
        postGuarantee(
          parties.vault,
          parties.guarantor,
          taskId,
          fromYocto(body.bondYocto),
          fromYocto(body.liabilityYocto),
        ),
      );
    } else if (body.type === "attempt_assigned") {
      const chainBid = reissue(body.bid, parties.payoutAccount);
      rebids.push({
        attempt: body.attempt,
        offchainBidHash: body.bid.bidHash,
        chainBidHash: chainBid.bidHash,
      });
      const payees = chainBid.bid.members.map((member) => ({
        account: member.account,
        amount: fromYocto(member.shareYocto),
      }));
      await step(
        `Coordinator commits attempt ${String(body.attempt)} to ${leadAgent(chainBid.bid)}`,
        registerAssignment(parties.vault, parties.coordinator, taskId, {
          attempt: body.attempt,
          agent: parties.payoutAccount(leadAgent(chainBid.bid)),
          bidHash: toHex32(chainBid.bidHash),
          payees,
        }),
      );
    } else if (body.type === "attempt_failed") {
      await step(
        `Coordinator opens recovery after attempt ${String(body.attempt)} (${body.reason})`,
        openRecovery(parties.vault, parties.coordinator, taskId, body.reason),
      );
    } else if (body.type === "verification_recorded") {
      evidenceByAttempt.set(body.evidence.body.attempt, body.evidence);
    } else if (body.type === "attempt_rejected" || body.type === "task_accepted") {
      const evidence = evidenceByAttempt.get(body.attempt);
      if (evidence === undefined)
        throw new Error(`No evidence for attempt ${String(body.attempt)}`);
      const rejected = body.type === "attempt_rejected";
      const evidenceHash =
        rejected && body.ruling !== null ? digestOf(body.ruling) : evidence.evidenceHash;
      await step(
        `Verifier records ${rejected ? "REJECT" : "ACCEPT"} for attempt ${String(body.attempt)}`,
        recordVerdict(parties.vault, parties.verifier, taskId, {
          attempt: body.attempt,
          artifactHash: toHex32(evidence.body.artifactHash),
          suiteHash,
          evidenceHash: toHex32(evidenceHash),
          outcome: rejected ? "REJECT" : "ACCEPT",
        }),
      );
    } else if (body.type === "settlement_started") {
      const finalize = body.kind === "success" ? finalizeSuccess : finalizeFailure;
      await step(
        `Coordinator finalizes the ${body.kind} settlement`,
        finalize(parties.vault, parties.coordinator, taskId),
      );
      await step(
        "A repeated settlement is refused",
        finalize(parties.vault, parties.coordinator, taskId),
        true,
      );
    }
  };

  for (const event of episode.driver.store.streams[taskId] ?? []) await apply(event.body);
  return { taskId, steps, rebids };
}
