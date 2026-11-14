import { Account, actions, KeyPair, PublicKey } from "near-api-js";
import { z } from "zod";
import { readOutcome, type ChainCall } from "./outcome.js";

export const vaultMethods = {
  coordinator: [
    "register_assignment",
    "open_recovery",
    "finalize_success",
    "finalize_failure",
    "retry_failed_transfer",
  ],
  verifier: ["record_verdict", "record_attested_verdict"],
} as const;
export type RestrictedRole = keyof typeof vaultMethods;

const permissionSchema = z.union([
  z.literal("FullAccess"),
  z.object({
    FunctionCall: z.object({
      receiver_id: z.string(),
      method_names: z.array(z.string()),
      allowance: z.string().nullable().optional(),
    }),
  }),
]);

export type KeyGrant =
  | { readonly kind: "full"; readonly publicKey: string }
  | {
      readonly kind: "function-call";
      readonly publicKey: string;
      readonly receiver: string;
      readonly methods: readonly string[];
    };

export async function keyGrants(account: Account): Promise<KeyGrant[]> {
  const list = await account.getAccessKeyList();
  return list.keys.map((key) => {
    const permission = permissionSchema.parse(key.access_key.permission);
    return permission === "FullAccess"
      ? { kind: "full", publicKey: key.public_key }
      : {
          kind: "function-call",
          publicKey: key.public_key,
          receiver: permission.FunctionCall.receiver_id,
          methods: permission.FunctionCall.method_names,
        };
  });
}

export type Restriction = {
  readonly account: Account;
  readonly keyPair: KeyPair;
  readonly call: ChainCall;
};

export async function restrictToVault(
  account: Account,
  vaultId: string,
  role: RestrictedRole,
  allowance: bigint,
  keyPair: KeyPair = KeyPair.fromRandom("ed25519"),
): Promise<Restriction> {
  const full = (await keyGrants(account)).filter((grant) => grant.kind === "full");
  const response = await account.signAndSendTransaction({
    receiverId: account.accountId,
    actions: [
      actions.addFunctionCallAccessKey(
        keyPair.getPublicKey(),
        vaultId,
        [...vaultMethods[role]],
        allowance,
      ),
      ...full.map((grant) => actions.deleteKey(PublicKey.from(grant.publicKey))),
    ],
    waitUntil: "EXECUTED_OPTIMISTIC",
    throwOnFailure: false,
  });
  return {
    account: new Account(account.accountId, account.provider, keyPair.toString()),
    keyPair,
    call: readOutcome(response),
  };
}
