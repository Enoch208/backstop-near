import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { baseEncode, type Account } from "near-api-js";
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

export async function ensureVault(
  contract: Account,
  roles: VaultRoles,
  wasm: Uint8Array = readFileSync(vaultWasmPath),
): Promise<{ vault: Vault; deploy: ChainCall | null; init: ChainCall | null }> {
  const vault = { contractId: contract.accountId };
  const { codeHash } = await contract.getState();
  const localHash = baseEncode(createHash("sha256").update(wasm).digest());
  if (codeHash !== emptyCodeHash && codeHash !== localHash) {
    throw new Error(
      `${contract.accountId} runs other code (${codeHash}); deploy to a fresh vault account`,
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
