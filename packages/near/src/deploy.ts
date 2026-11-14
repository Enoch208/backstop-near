import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { actions, baseEncode, teraToGas, type Account } from "near-api-js";
import { readOutcome, type ChainCall } from "./outcome.js";
import { callVault, getRoles, type Vault } from "./vault.js";

export const vaultWasmPath = fileURLToPath(
  new URL(
    "../../../contracts/outcome-vault/target/wasm32-unknown-unknown/release/outcome_vault.wasm",
    import.meta.url,
  ),
);

export type VaultRoles = {
  readonly owner: string;
  readonly coordinator: string;
  readonly verifier: string;
};

export async function deployVault(
  contract: Account,
  roles: VaultRoles,
  wasm: Uint8Array = readFileSync(vaultWasmPath),
): Promise<{ vault: Vault; deploy: ChainCall; init: ChainCall }> {
  const deploy = readOutcome(await contract.deployContract(wasm));
  const vault = { contractId: contract.accountId };
  const init = await callVault(vault, contract, "new", { ...roles });
  return { vault, deploy, init };
}

const emptyCodeHash = "11111111111111111111111111111111";

export const codeHashOf = (wasm: Uint8Array): string =>
  baseEncode(createHash("sha256").update(wasm).digest());

export const publishedHashPath = fileURLToPath(
  new URL("../../../contracts/outcome-vault/outcome_vault.wasm.sha256", import.meta.url),
);

export function publishedCodeHash(path = publishedHashPath): string {
  return baseEncode(Buffer.from(readFileSync(path, "utf8").slice(0, 64), "hex"));
}

export async function upgradeVault(contract: Account, wasm: Uint8Array): Promise<ChainCall> {
  const response = await contract.signAndSendTransaction({
    receiverId: contract.accountId,
    actions: [
      actions.deployContract(wasm),
      actions.functionCall("migrate", {}, teraToGas("100"), 0n),
    ],
    waitUntil: "EXECUTED_OPTIMISTIC",
    throwOnFailure: false,
  });
  return readOutcome(response);
}

export async function ensureVault(
  contract: Account,
  roles: VaultRoles,
  wasm: Uint8Array = readFileSync(vaultWasmPath),
): Promise<{ vault: Vault; deploy: ChainCall | null; init: ChainCall | null }> {
  const vault = { contractId: contract.accountId };
  const { codeHash } = await contract.getState();
  const localHash = codeHashOf(wasm);
  const known = codeHash === localHash || codeHash === publishedCodeHash();
  if (codeHash !== emptyCodeHash && !known) {
    throw new Error(
      `${contract.accountId} runs other code (${codeHash}); upgrade it with pnpm vault:upgrade or use a fresh vault account`,
    );
  }
  const deploy =
    codeHash === emptyCodeHash ? readOutcome(await contract.deployContract(wasm)) : null;
  const current = await getRoles(vault, contract).catch((error: unknown) => {
    if (error instanceof Error && /initiali[sz]ed/i.test(error.message)) return null;
    throw error;
  });
  if (current !== null) {
    const matches =
      current.owner === roles.owner &&
      current.coordinator === roles.coordinator &&
      current.verifier === roles.verifier;
    if (!matches) throw new Error(`${contract.accountId} is initialized with other roles`);
    return { vault, deploy, init: null };
  }
  return { vault, deploy, init: await callVault(vault, contract, "new", { ...roles }) };
}
