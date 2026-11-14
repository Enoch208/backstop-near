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

async function deployCode(contract: Account, wasm: Uint8Array): Promise<ChainCall> {
  const call = readOutcome(
    await contract.signAndSendTransaction({
      receiverId: contract.accountId,
      actions: [actions.deployContract(wasm)],
      waitUntil: "FINAL",
      throwOnFailure: false,
    }),
  );
  if (!call.ok)
    throw new Error(
      `Vault code deployment failed (${call.txHash}): ${call.errorCode ?? "unknown"}`,
    );
  return call;
}

export async function deployVault(
  contract: Account,
  roles: VaultRoles,
  wasm: Uint8Array = readFileSync(vaultWasmPath),
): Promise<{ vault: Vault; deploy: ChainCall; init: ChainCall }> {
  const deploy = await deployCode(contract, wasm);
  const vault = { contractId: contract.accountId };
  const init = await callVault(vault, contract, "new", { ...roles });
  return { vault, deploy, init };
}

const emptyCodeHash = "11111111111111111111111111111111";

export async function deployTokenVault(
  contract: Account,
  roles: VaultRoles,
  asset: NonNullable<Vault["token"]>,
  wasm: Uint8Array = readFileSync(vaultWasmPath),
): Promise<ChainCall> {
  if ((await contract.getState()).codeHash !== emptyCodeHash)
    throw new Error("Token vault deployment requires a fresh contract account");
  return readOutcome(
    await contract.signAndSendTransaction({
      receiverId: contract.accountId,
      actions: [
        actions.deployContract(wasm),
        actions.functionCall(
          "new_with_token",
          {
            ...roles,
            token_contract: asset.contractId,
            min_escrow: "10000",
          },
          teraToGas("45"),
          0n,
        ),
      ],
      waitUntil: "FINAL",
      throwOnFailure: false,
    }),
  );
}

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
    waitUntil: "FINAL",
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
  if (codeHash === emptyCodeHash) return deployVault(contract, roles, wasm);
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
    return { vault, deploy: null, init: null };
  }
  return { vault, deploy: null, init: await callVault(vault, contract, "new", { ...roles }) };
}
