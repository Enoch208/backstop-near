import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asPrincipal, primaryBid, principals, roster } from "@backstop/agents";
import { candidate, checkoutManifest } from "@backstop/fixture-checkout";
import { getLedger, setUpChain, type ChainSetup } from "@backstop/near";
import { near, toYocto } from "@backstop/shared";
import { apiClient } from "@backstop/workers";
import { z } from "zod";
import {
  chainBridge,
  createRuntime,
  startApi,
  type ApiServer,
  type Runtime,
} from "../src/index.js";

const timing = {
  leaseMs: 60_000,
  heartbeatGraceMs: 5_000,
  bidWindowMs: 5_000,
  challengeWindowMs: 1_000,
};
let chain: ChainSetup;
let runtime: Runtime;
let api: ApiServer;

const fund = (pool: string, amount: string) => ({
  pool,
  amountYocto: toYocto(near(amount)),
  liabilityYocto: null,
});
const stateOf = (taskId: string) => runtime.store.records[taskId]?.state;

async function until(check: () => boolean, ms = 60_000): Promise<void> {
  for (let waited = 0; waited < ms && !check(); waited += 200)
    await new Promise((resolve) => setTimeout(resolve, 200));
}

beforeAll(async () => {
  chain = await setUpChain({ network: "sandbox" }, () => undefined);
  runtime = createRuntime(Date.now, false);
  runtime.chain = chainBridge("sandbox", chain.parties, () => undefined);
  api = await startApi(runtime, "127.0.0.1", 0, 100);
});

afterAll(async () => {
  await api.close();
  await chain.stop();
});

describe("the API settling on a live NEAR node", () => {
  it("records a deposit only after NEAR accepts it, and nothing when NEAR refuses it", async () => {
    const customer = apiClient(api.url, principals.customer);
    await customer.post("/api/tasks", {
      manifest: checkoutManifest({
        taskId: "chain-dust",
        createdAtMs: Date.now(),
        maxAttempts: 3,
        timing,
      }),
    });
    const dust = await customer.post("/api/tasks/chain-dust/funding", fund("escrow", "0.001"));
    expect(dust.status).toBe(422);
    expect(JSON.stringify(dust.body)).toContain("ERR_DUST_ESCROW");
    expect(runtime.store.records["chain-dust"]?.ledger.inflow.escrow).toBe(0n);
  });

  it("settles only on the contract's own transfer callbacks, with matching ids and amounts", async () => {
    const taskId = "chain-live";
    const customer = apiClient(api.url, principals.customer);
    const gamma = apiClient(api.url, asPrincipal(roster.gamma));
    await customer.post("/api/tasks", {
      manifest: checkoutManifest({ taskId, createdAtMs: Date.now(), maxAttempts: 3, timing }),
    });
    const escrow = await customer.post(`/api/tasks/${taskId}/funding`, fund("escrow", "0.40"));
    expect(JSON.stringify(escrow.body)).toContain('"reference":"near:');
    await customer.post(`/api/tasks/${taskId}/funding`, fund("premium", "0.04"));
    await apiClient(api.url, principals.guarantor).post(
      `/api/tasks/${taskId}/funding`,
      fund("bond", "0.25"),
    );
    await gamma.post(`/api/tasks/${taskId}/bids`, {
      bid: primaryBid(roster.gamma, taskId, "0.30", Date.now()),
    });
    await gamma.post(`/api/tasks/${taskId}/claim`, {});
    await gamma.post(`/api/tasks/${taskId}/artifacts`, {
      fencingToken: 1,
      source: candidate("gamma-integer").source,
      checkpointHash: null,
    });
    await until(() => stateOf(taskId) === "SETTLED");
    expect(stateOf(taskId)).toBe("SETTLED");
    const offchain = runtime.store.records[taskId]?.ledger.transfers ?? [];
    const indexed = (runtime.store.streams[taskId] ?? []).filter(
      (event) => event.actor === "near-indexer",
    );
    expect(indexed.length).toBeGreaterThan(0);
    const onchain = await getLedger(chain.parties.vault, chain.contract, taskId);
    expect(onchain).toMatchObject({
      state: "SETTLED",
      total_inflow: toYocto(near("0.69")),
      confirmed_outflow: toYocto(near("0.69")),
    });
    const chainAmounts = z
      .array(z.object({ amount: z.string() }))
      .parse(onchain?.confirmed_by_recipient)
      .map((row) => row.amount)
      .sort();
    const offchainByRecipient = new Map<string, bigint>();
    for (const transfer of offchain)
      offchainByRecipient.set(
        transfer.recipient,
        (offchainByRecipient.get(transfer.recipient) ?? 0n) + transfer.amount,
      );
    expect([...offchainByRecipient.values()].map(String).sort()).toEqual(chainAmounts);
    expect(offchain.map((transfer) => transfer.id)).toEqual(
      offchain.map((_, index) => `${taskId}:1:${String(index)}`),
    );
    expect(runtime.chain?.log.filter((entry) => entry.diverged)).toEqual([]);
  });
});
