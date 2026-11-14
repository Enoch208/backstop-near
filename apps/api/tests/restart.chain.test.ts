import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asPrincipal, principals, primaryBid, roster } from "@backstop/agents";
import { candidate, checkoutManifest, liveTiming } from "@backstop/fixture-checkout";
import { getLedger, getTransfer, setUpChain, type ChainParties } from "@backstop/near";
import { near, toYocto } from "@backstop/shared";
import { expect, it, vi } from "vitest";
import { chainBridge, createRuntime, startApi, tick } from "../src/index.js";
import { call, signedRequest } from "./support.js";

const fund = (pool: string, amount: string) => ({
  pool,
  amountYocto: toYocto(near(amount)),
  liabilityYocto: null,
});

it("recovers final funding and payout effects when their RPC responses are lost", async () => {
  const dir = mkdtempSync(join(tmpdir(), "backstop-chain-restart-"));
  const chain = await setUpChain({ network: "sandbox" }, () => undefined);
  const clock = { now: Date.now() };
  const path = join(dir, "state.sqlite");
  const open = (parties: ChainParties = chain.parties) => {
    const runtime = createRuntime(() => clock.now, false, path);
    runtime.chain = chainBridge("sandbox", parties, () => undefined);
    return runtime;
  };
  let runtime = open();
  const storage = () => {
    const store = runtime.persistence;
    if (store === null) throw new Error("The test requires durable storage");
    return store;
  };
  const taskId = "chain-restart";
  const base = `/api/tasks/${taskId}`;
  let api: Awaited<ReturnType<typeof startApi>> | undefined;
  let interrupt = false;
  let didInterrupt = false;
  const provider = chain.parties.customer.provider;
  const sendUntil = provider.sendTransactionUntil.bind(provider);
  const networkSend = vi
    .spyOn(provider, "sendTransactionUntil")
    .mockImplementation(async (...args) => {
      const answer = await sendUntil(...args);
      if (interrupt) {
        interrupt = false;
        didInterrupt = true;
        throw new Error("Final NEAR response lost before indexing");
      }
      return answer;
    });
  try {
    const manifest = checkoutManifest({
      taskId,
      createdAtMs: clock.now,
      maxAttempts: 3,
      timing: { ...liveTiming, challengeWindowMs: 1_000 },
    });
    const opened = await call(runtime, clock, principals.customer, "/api/tasks", { manifest });
    expect(opened.status).toBe(201);
    if (runtime.chain !== null) await Promise.all(runtime.chain.queues.values());

    interrupt = true;
    const funding = `${base}/funding`;
    const escrow = fund("escrow", "0.40");
    await expect(
      call(runtime, clock, principals.customer, funding, escrow, "durable-funding-1"),
    ).rejects.toThrow("Final NEAR response lost before indexing");
    expect(didInterrupt).toBe(true);
    expect(runtime.store.records[taskId]?.ledger.inflow.escrow).toBe(0n);
    expect(await getLedger(chain.parties.vault, chain.contract, taskId)).toMatchObject({
      escrow_available: escrow.amountYocto,
    });

    storage().close();
    runtime = open();
    api = await startApi(runtime, "127.0.0.1", 0, 60_000);
    const envelope = await signedRequest(principals.customer, funding, escrow, {
      requestId: "durable-funding-1",
      issuedAtMs: clock.now,
    }).text();
    const replay = await fetch(`${api.url}${funding}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: envelope,
    });
    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotent-replay")).toBe("true");
    expect(runtime.store.records[taskId]?.ledger.inflow.escrow).toBe(near("0.40"));

    await call(runtime, clock, principals.customer, funding, fund("premium", "0.04"));
    await call(runtime, clock, principals.guarantor, funding, fund("bond", "0.25"));
    const gamma = asPrincipal(roster.gamma);
    await call(runtime, clock, gamma, `${base}/bids`, {
      bid: primaryBid(roster.gamma, taskId, "0.30", clock.now),
    });
    await call(runtime, clock, gamma, `${base}/claim`, {});
    await call(runtime, clock, gamma, `${base}/artifacts`, {
      fencingToken: 1,
      source: candidate("gamma-integer").source,
      checkpointHash: null,
    });
    const bridge = runtime.chain;
    if (bridge === null) throw new Error("Chain bridge missing");
    await vi.waitFor(
      () => {
        expect(bridge.cursor.get(taskId)).toBe(runtime.store.records[taskId]?.version);
      },
      { timeout: 30_000, interval: 100 },
    );
    clock.now += 1_001;
    tick(runtime);
    await vi.waitFor(
      () => {
        expect(bridge.log.some(({ step }) => step.label.includes("records ACCEPT"))).toBe(true);
      },
      { timeout: 30_000, interval: 100 },
    );
    await Promise.all(bridge.queues.values());

    didInterrupt = false;
    interrupt = true;
    tick(runtime);
    await Promise.all(bridge.queues.values());
    expect(didInterrupt).toBe(true);
    expect(runtime.store.records[taskId]?.state).toBe("SETTLEMENT_PENDING");
    const transferId = `${taskId}:1:0`;
    expect(await getTransfer(chain.parties.vault, chain.contract, transferId)).toMatchObject({
      status: "CONFIRMED",
      amount: toYocto(near("0.30")),
    });
    await api.close();
    api = undefined;

    runtime = open();
    api = await startApi(runtime, "127.0.0.1", 0, 100);
    await vi.waitFor(
      () => {
        expect(runtime.store.records[taskId]?.state).toBe("SETTLED");
      },
      { timeout: 30_000, interval: 100 },
    );
    expect(await getLedger(chain.parties.vault, chain.contract, taskId)).toMatchObject({
      total_inflow: toYocto(near("0.69")),
      confirmed_outflow: toYocto(near("0.69")),
      pending_outflow: "0",
    });
    const indexed = runtime.store.streams[taskId]?.filter(
      (event) => event.body.type === "transfer_resolved",
    );
    expect(indexed).toHaveLength(runtime.store.records[taskId]?.ledger.transfers.length ?? 0);
    expect(networkSend).toHaveBeenCalledTimes(6);
  } finally {
    if (api !== undefined) await api.close();
    else storage().close();
    networkSend.mockRestore();
    await chain.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
