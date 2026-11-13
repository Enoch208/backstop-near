import { DEFAULT_ACCOUNT_ID, DEFAULT_PRIVATE_KEY, Sandbox } from "near-sandbox";
import { Account } from "near-api-js";

export type LocalChain = {
  readonly rpcUrl: string;
  readonly root: Account;
  readonly stop: () => Promise<void>;
};

export async function startLocalChain(): Promise<LocalChain> {
  const sandbox = await Sandbox.start({});
  return {
    rpcUrl: sandbox.rpcUrl,
    root: new Account(DEFAULT_ACCOUNT_ID, sandbox.rpcUrl, DEFAULT_PRIVATE_KEY),
    stop: () => sandbox.tearDown(),
  };
}
