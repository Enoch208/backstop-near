import {
  appendTestnetRun,
  chainOptionsFromEnv,
  createTask,
  explorerTx,
  finalizeFailure,
  finalizeSuccess,
  fundPremium,
  getLedger,
  postGuarantee,
  recordAttestedVerdict,
  recordVerdict,
  registerAssignment,
  registerTeeSigner,
  setUpChain,
  toHex32,
  type ChainCall,
  type ChainStep,
} from "@backstop/near";
import { digestOf, near, sha256Hex } from "@backstop/shared";
import { addressOfSecret, signPersonal } from "@backstop/tee";

const out = (line: string) => process.stdout.write(`${line}\n`);
const setup = await setUpChain(chainOptionsFromEnv("testnet", process.env), out);
const { vault, customer, guarantor, coordinator, verifier } = setup.parties;
const taskId = `redteam-${Date.now().toString(36)}`;
const zero = "0".repeat(64);
const steps: ChainStep[] = [];

async function step(label: string, call: Promise<ChainCall>, refusalExpected: boolean) {
  const result = await call;
  steps.push({ label, call: result, refusalExpected });
  const outcome = result.ok ? "ok" : `refused ${result.errorCode ?? ""}`;
  const verdict = result.ok === !refusalExpected ? "as expected" : "UNEXPECTED";
  out(`  ${label.padEnd(74)} ${outcome.padEnd(30)} ${verdict} ${explorerTx(result.txHash)}`);
}

const model = "deepseek-ai/DeepSeek-V4.1-Flash-1017";
const laptop = Uint8Array.from(Buffer.from(sha256Hex("red team laptop key"), "hex"));
const signedText = `${model}:${sha256Hex("forged request")}:${sha256Hex("forged reply")}`;
const deadlineNs = BigInt(Date.now() + 3_600_000) * 1_000_000n;

out(`Red team against ${vault.contractId} on testnet, task ${taskId}`);
await step(
  "Customer creates the task and escrows",
  createTask(
    vault,
    customer,
    taskId,
    toHex32(digestOf(taskId)),
    {
      deadlineNs,
      maxAttempts: 1,
      compensationCap: near("0.01"),
    },
    near("0.05"),
  ),
  false,
);
await step(
  "Attack: the customer guarantees its own task",
  postGuarantee(vault, customer, taskId, near("0.03"), near("0.03")),
  true,
);
await step("Customer pays the premium", fundPremium(vault, customer, taskId, near("0.005")), false);
await step(
  "Guarantor bonds the outcome",
  postGuarantee(vault, guarantor, taskId, near("0.03"), near("0.03")),
  false,
);
await step(
  "Attack: the coordinator assigns more than escrow plus liability",
  registerAssignment(vault, coordinator, taskId, {
    attempt: 1,
    agent: guarantor.accountId,
    bidHash: zero,
    payees: [{ account: guarantor.accountId, amount: near("1") }],
  }),
  true,
);
await step(
  "Coordinator commits attempt 1",
  registerAssignment(vault, coordinator, taskId, {
    attempt: 1,
    agent: setup.parties.payoutAccount("gamma"),
    bidHash: zero,
    payees: [{ account: setup.parties.payoutAccount("gamma"), amount: near("0.04") }],
  }),
  false,
);
const verdict = { attempt: 1, artifactHash: zero, suiteHash: zero, evidenceHash: zero };
await step(
  "Attack: the customer records its own ACCEPT",
  recordVerdict(vault, customer, taskId, { ...verdict, outcome: "ACCEPT" }),
  true,
);
await step(
  "Attack: a verdict for an attempt that is not current",
  recordVerdict(vault, verifier, taskId, { ...verdict, attempt: 7, outcome: "ACCEPT" }),
  true,
);
await step(
  `Attack: an AI receipt signed by an unattested key (${addressOfSecret(laptop).slice(0, 10)}…)`,
  recordAttestedVerdict(vault, verifier, taskId, {
    ...verdict,
    signedText,
    signature: signPersonal(signedText, laptop),
  }),
  true,
);
await step(
  "Attack: the customer settles before any verdict",
  finalizeSuccess(vault, customer, taskId),
  true,
);
await step(
  "Attack: someone other than the owner registers an enclave key",
  registerTeeSigner(vault, customer, addressOfSecret(laptop), model, zero),
  true,
);
await step(
  "Verifier records REJECT; one attempt was allowed, so the task fails",
  recordVerdict(vault, verifier, taskId, { ...verdict, outcome: "REJECT" }),
  false,
);
await step(
  "Coordinator settles the failure and returns the funds",
  finalizeFailure(vault, coordinator, taskId),
  false,
);

const ledger = await getLedger(vault, setup.contract, taskId);
out(
  `On-chain ledger: ${ledger?.state ?? "missing"}, in ${ledger?.total_inflow ?? "?"}, confirmed out ${ledger?.confirmed_outflow ?? "?"}`,
);
const unexpected = steps.filter((entry) => entry.call.ok === entry.refusalExpected);
appendTestnetRun(setup.contract.accountId, null, { kind: "red team", taskId, steps, extra: {} });
out(`Recorded ${String(steps.length)} transactions in deployments/testnet.json`);
await setup.stop();
process.exit(unexpected.length === 0 ? 0 : 1);
