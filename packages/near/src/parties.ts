import { near } from "@backstop/shared";
import { Account } from "near-api-js";
import { getRoles } from "./vault.js";
import { ensureSubAccounts } from "./accounts.js";
import { ensureVault } from "./deploy.js";
import { startLocalChain } from "./local.js";
import type { ChainParties } from "./mirror.js";
import { defaultTestnetRpc, testnetParty, testnetRoot, topUp } from "./network.js";
import { loadKey, parseKey } from "./credentials.js";
import { restrictToVault, type RestrictedRole } from "./keys.js";

export const partyFunding: Readonly<Record<string, bigint>> = {
  vault: near("4"),
  customer: near("1"),
  guarantor: near("0.6"),
  coordinator: near("0.5"),
  verifier: near("0.5"),
  alpha: near("0.05"),
  beta: near("0.05"),
  gamma: near("0.05"),
  delta: near("0.05"),
  epsilon: near("0.05"),
};

const workingBalance: Readonly<Record<string, bigint>> = {
  customer: near("0.8"),
  guarantor: near("0.5"),
  coordinator: near("1"),
  verifier: near("0.4"),
};

export type ChainOptions =
  | { readonly network: "sandbox" }
  | {
      readonly network: "testnet";
      readonly account: string;
      readonly privateKey: string | null;
      readonly rpc: string | null;
    };

export type ChainSetup = {
  readonly network: "sandbox" | "testnet";
  readonly parties: ChainParties;
  readonly contract: Account;
  readonly deployTx: string | null;
  readonly stop: () => Promise<void>;
};

async function accountsFor(options: ChainOptions, log: (line: string) => void) {
  const names = Object.keys(partyFunding);
  if (options.network === "sandbox") {
    const chain = await startLocalChain();
    const accounts = await ensureSubAccounts(
      chain.root,
      names,
      (name) => (partyFunding[name] ?? 0n) * 5n,
    );
    return { accounts, stop: chain.stop };
  }
  const root = testnetRoot(
    options.account,
    options.privateKey === null ? null : parseKey(options.privateKey),
    options.rpc ?? defaultTestnetRpc,
  );
  const accounts: Record<string, Account> = {};
  for (const name of names) {
    const account = await testnetParty(root, name, partyFunding[name] ?? 0n);
    const toppedUp = await topUp(root, account, workingBalance[name] ?? 0n);
    if (toppedUp !== null) log(`Topped up ${account.accountId} in ${toppedUp}`);
    accounts[name] = account;
  }
  return { accounts, stop: () => Promise.resolve() };
}

async function restrictRoles(
  party: (name: string) => Account,
  vaultId: string,
  log: (line: string) => void,
): Promise<Record<"coordinator" | "verifier", Account>> {
  const restrict = async (role: RestrictedRole) => {
    const restriction = await restrictToVault(party(role), vaultId, role, near("2"));
    if (!restriction.call.ok)
      throw new Error(`Could not restrict ${role}: ${restriction.call.errorCode ?? "unknown"}`);
    return restriction.account;
  };
  const restricted = {
    coordinator: await restrict("coordinator"),
    verifier: await restrict("verifier"),
  };
  log(`Coordinator and verifier keys are now function-call keys for ${vaultId} only`);
  return restricted;
}

export async function setUpChain(
  options: ChainOptions,
  log: (line: string) => void,
): Promise<ChainSetup> {
  const { accounts, stop } = await accountsFor(options, log);
  const party = (name: string): Account => {
    const account = accounts[name];
    if (account === undefined) throw new Error(`No account ${name}`);
    return account;
  };
  const contract = party("vault");
  const prepared = await ensureVault(contract, {
    owner: contract.accountId,
    coordinator: party("coordinator").accountId,
    verifier: party("verifier").accountId,
  });
  const roles =
    options.network === "sandbox"
      ? await restrictRoles(party, contract.accountId, log)
      : { coordinator: party("coordinator"), verifier: party("verifier") };
  return {
    network: options.network,
    contract,
    deployTx: prepared.deploy?.txHash ?? null,
    stop,
    parties: {
      vault: prepared.vault,
      customer: party("customer"),
      guarantor: party("guarantor"),
      coordinator: roles.coordinator,
      verifier: roles.verifier,
      payoutAccount: (agentId) => party(agentId).accountId,
    },
  };
}

export function chainOptionsFromEnv(
  network: string,
  env: Record<string, string | undefined>,
): ChainOptions {
  if (network === "sandbox") return { network };
  if (network !== "testnet")
    throw new Error(`Unknown network "${network}". Use sandbox or testnet.`);
  const account = env.BACKSTOP_TESTNET_ACCOUNT;
  if (account === undefined)
    throw new Error("Set BACKSTOP_TESTNET_ACCOUNT to a funded testnet account you control");
  return {
    network,
    account,
    privateKey: env.BACKSTOP_TESTNET_PRIVATE_KEY ?? null,
    rpc: env.BACKSTOP_TESTNET_RPC ?? null,
  };
}

export async function connectTestnetVault(account: string, rpc: string): Promise<ChainParties> {
  const connect = (role: string) => {
    const id = `${role}.${account}`;
    const key = loadKey("testnet", id);
    if (key === null) throw new Error(`NEAR credentials are required for ${id}`);
    return new Account(id, rpc, key);
  };
  const vault = { contractId: `vault.${account}` };
  const customer = connect("customer");
  const guarantor = connect("guarantor");
  const coordinator = connect("coordinator");
  const verifier = connect("verifier");
  const roles = await getRoles(vault, coordinator);
  if (roles?.coordinator !== coordinator.accountId || roles.verifier !== verifier.accountId)
    throw new Error(
      `The deployed vault ${vault.contractId} does not authorize the configured roles`,
    );
  return {
    vault,
    customer,
    guarantor,
    coordinator,
    verifier,
    payoutAccount: (agentId) => `${agentId}.${account}`,
  };
}
