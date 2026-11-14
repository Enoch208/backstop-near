import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { near } from "@backstop/shared";
import { actions, type Account } from "near-api-js";
import {
  callVault,
  deployVault,
  ensureSubAccounts,
  keyGrants,
  restrictToVault,
  startLocalChain,
  vaultMethods,
  type LocalChain,
  type Vault,
} from "../src/index.js";

let chain: LocalChain;
let accounts: Record<string, Account>;
let vault: Vault;
let coordinator: Account;

const party = (name: string): Account => {
  const account = accounts[name];
  if (account === undefined) throw new Error(`No account ${name}`);
  return account;
};

async function refusal(action: () => Promise<{ ok: boolean; errorCode: string | null }>) {
  try {
    const call = await action();
    return call.ok ? "accepted" : (call.errorCode ?? "refused");
  } catch (error) {
    if (error instanceof Error) return error.message;
    throw error;
  }
}

beforeAll(async () => {
  chain = await startLocalChain();
  accounts = await ensureSubAccounts(
    chain.root,
    ["vault", "customer", "coordinator", "verifier"],
    (name) => (name === "vault" ? near("10") : near("5")),
  );
  const deployed = await deployVault(party("vault"), {
    owner: party("vault").accountId,
    coordinator: party("coordinator").accountId,
    verifier: party("verifier").accountId,
  });
  vault = deployed.vault;
  const restriction = await restrictToVault(
    party("coordinator"),
    vault.contractId,
    "coordinator",
    near("1"),
  );
  expect(restriction.call.ok).toBe(true);
  coordinator = restriction.account;
});

afterAll(async () => {
  await chain.stop();
});

describe("least-privilege role keys on a local NEAR node", () => {
  it("leaves the coordinator one function-call key, for the vault's coordinator methods only", async () => {
    expect(await keyGrants(coordinator)).toEqual([
      {
        kind: "function-call",
        publicKey: expect.any(String) as unknown,
        receiver: vault.contractId,
        methods: [...vaultMethods.coordinator],
      },
    ]);
  });

  it("still reaches the contract for a coordinator method", async () => {
    const call = await callVault(vault, coordinator, "open_recovery", {
      task_id: "no-such-task",
      failure_code: "LEASE_EXPIRED",
    });
    expect(call).toMatchObject({ ok: false, errorCode: "ERR_UNKNOWN_TASK" });
  });

  it("cannot call another vault method, move NEAR, or touch another contract", async () => {
    expect(
      await refusal(() => callVault(vault, coordinator, "fund_task", { task_id: "x" })),
    ).toMatch(/MethodNameMismatch|method/i);
    expect(
      await refusal(async () => {
        await coordinator.signAndSendTransaction({
          receiverId: party("customer").accountId,
          actions: [actions.transfer(near("1"))],
        });
        return { ok: true, errorCode: null };
      }),
    ).not.toBe("accepted");
    expect(
      await refusal(() =>
        callVault({ contractId: party("customer").accountId }, coordinator, "open_recovery", {}),
      ),
    ).toMatch(/ReceiverMismatch|receiver/i);
  });
});
