import {
  digestOf,
  digestSchema,
  fromYocto,
  leadAgent,
  repairRunnerId,
  repairTaskSchema,
  signatureSchema,
  signedBidSchema,
  suiteHash,
  taskManifestSchema,
} from "@backstop/shared";
import { checkoutRunnerId, checkoutSuite, checkoutSuiteHash } from "@backstop/fixture-checkout";
import { fitsToken } from "@backstop/near";
import { roster } from "@backstop/agents";
import { z } from "zod";
import { signedWrite } from "../auth.js";
import { failure } from "../http.js";
import { invalidRepairTask } from "../repair-task.js";
import { execute, type Runtime } from "../runtime.js";
import { fromOutcome, parseBody, refuse } from "./outcome.js";

const createBody = z.strictObject({
  manifest: taskManifestSchema,
  repairTask: repairTaskSchema.optional(),
});
const bidBody = z.strictObject({ bid: signedBidSchema });
const endorseBody = z.strictObject({ bidHash: digestSchema, signature: signatureSchema });

export function createTask(runtime: Runtime, request: Request): Promise<Response> {
  return signedWrite(runtime, request, ({ actor, body }) => {
    const parsed = parseBody(createBody, body);
    if (!parsed.ok) return { error: parsed.error, taskVersion: null };
    const { manifest, repairTask } = parsed.value;
    const vault = runtime.chain?.parties.vault;
    if (
      vault?.token !== undefined &&
      [
        manifest.budget.escrowYocto,
        manifest.budget.premiumYocto,
        manifest.guarantee?.maxLiabilityYocto ?? "0",
        manifest.guarantee?.compensationCapYocto ?? "0",
      ].some((value) => !fitsToken(vault, fromYocto(value)))
    ) {
      return refuse(
        runtime,
        manifest.taskId,
        failure("POLICY_VIOLATION", "The manifest has more precision than the settlement token"),
      );
    }
    if (manifest.owner !== actor.account) {
      return refuse(
        runtime,
        manifest.taskId,
        failure("UNAUTHORIZED", "Only the manifest owner creates the task"),
      );
    }
    const taskHash = manifest.repairTaskHash;
    if (repairTask === undefined) {
      if (
        taskHash !== undefined ||
        manifest.suite.suiteHash !== checkoutSuiteHash ||
        manifest.suite.suiteId !== checkoutSuite.suiteId ||
        manifest.suite.runnerId !== checkoutRunnerId
      ) {
        return refuse(
          runtime,
          manifest.taskId,
          failure("POLICY_VIOLATION", "The manifest selects an unknown suite"),
        );
      }
    } else {
      if (
        taskHash === undefined ||
        taskHash !== digestOf(repairTask) ||
        manifest.objective !== repairTask.objective ||
        manifest.suite.suiteId !== repairTask.suite.suiteId ||
        manifest.suite.suiteHash !== suiteHash(repairTask.suite) ||
        manifest.suite.runnerId !== repairRunnerId
      ) {
        return refuse(
          runtime,
          manifest.taskId,
          failure("POLICY_VIOLATION", "The manifest must pin the repair task, suite and runner"),
        );
      }
      const invalid = invalidRepairTask(repairTask);
      if (invalid !== null)
        return refuse(runtime, manifest.taskId, failure("POLICY_VIOLATION", invalid));
    }
    const outcome = execute(runtime, manifest.taskId, actor.id, { kind: "create", manifest });
    if (outcome.ok && taskHash !== undefined && repairTask !== undefined) {
      runtime.repairTasks.set(taskHash, repairTask);
    }
    return fromOutcome(runtime, manifest.taskId, outcome, 201);
  });
}

export function bid(runtime: Runtime, request: Request, taskId: string): Promise<Response> {
  return signedWrite(runtime, request, ({ actor, body }) => {
    const parsed = parseBody(bidBody, body);
    if (!parsed.ok) return refuse(runtime, taskId, parsed.error);
    const signed = parsed.value.bid;
    if (leadAgent(signed.bid) !== actor.id) {
      return refuse(
        runtime,
        taskId,
        failure("UNAUTHORIZED", "A bid is submitted by its lead agent"),
      );
    }
    const record = runtime.store.records[taskId];
    const members = signed.bid.members;
    const vault = runtime.chain?.parties.vault;
    if (
      vault?.token !== undefined &&
      members.some(({ shareYocto }) => !fitsToken(vault, fromYocto(shareYocto)))
    ) {
      return refuse(
        runtime,
        taskId,
        failure("POLICY_VIOLATION", "A bid share has more precision than the settlement token"),
      );
    }
    if (
      members.some((member) => runtime.identities.get(member.agentId)?.account !== member.account)
    ) {
      return refuse(
        runtime,
        taskId,
        failure("POLICY_VIOLATION", "Bid payees must match registered accounts"),
      );
    }
    const builtIn = members.map((member) =>
      Object.values(roster).some((agent) => agent.agentId === member.agentId),
    );
    if (
      builtIn.includes(false) &&
      (record?.manifest.repairTaskHash === undefined || builtIn.includes(true))
    ) {
      return refuse(
        runtime,
        taskId,
        failure(
          "POLICY_VIOLATION",
          "Use outside workers on an isolated repair task; fixture and outside payout accounts cannot share a bid",
        ),
      );
    }
    if (new Set(members.map((member) => member.account)).size !== members.length) {
      return refuse(runtime, taskId, failure("POLICY_VIOLATION", "Bid payees must be distinct"));
    }
    if (
      members.some((member) =>
        Object.values(
          runtime.chain === null
            ? {}
            : {
                customer: runtime.chain.parties.customer.accountId,
                guarantor: runtime.chain.parties.guarantor.accountId,
                verifier: runtime.chain.parties.verifier.accountId,
                coordinator: runtime.chain.parties.coordinator.accountId,
                vault: runtime.chain.parties.vault.contractId,
              },
        ).includes(member.account),
      ) ||
      members.some(
        (member) =>
          member.account === record?.manifest.owner || member.account === record?.ledger.guarantor,
      )
    ) {
      return refuse(
        runtime,
        taskId,
        failure("POLICY_VIOLATION", "Funding and control accounts cannot receive worker pay"),
      );
    }
    if (runtime.pendingFunding.has(taskId))
      return refuse(
        runtime,
        taskId,
        failure("STALE_STATE", "A NEAR funding action is awaiting confirmation"),
      );
    const state = record?.state;
    if (signed.bid.epoch === 0 && (state === "FUNDED" || state === "BONDED")) {
      return fromOutcome(
        runtime,
        taskId,
        execute(runtime, taskId, "coordinator", { kind: "assignPrimary", bid: signed }),
      );
    }
    return fromOutcome(
      runtime,
      taskId,
      execute(runtime, taskId, actor.id, { kind: "bid", bid: signed }),
    );
  });
}

export function endorse(runtime: Runtime, request: Request, taskId: string): Promise<Response> {
  return signedWrite(runtime, request, ({ actor, body }) => {
    const parsed = parseBody(endorseBody, body);
    if (!parsed.ok) return refuse(runtime, taskId, parsed.error);
    return fromOutcome(
      runtime,
      taskId,
      execute(runtime, taskId, actor.id, {
        kind: "endorse",
        bidHash: parsed.value.bidHash,
        endorsement: { agentId: actor.id, signature: parsed.value.signature },
      }),
    );
  });
}
