import { Accordion } from "../components/Accordion.js";
import { Pill } from "../components/Pill.js";
import { inferenceSchema, useVaultView, type ChainInference, type Reading } from "../data/near.js";
import { enclaveKey, liveRun, repository } from "../data/record.js";

const folds = [
  {
    title: "Held-out checks and a paid challenger",
    body: "Hidden tests run in a sandbox, and a challenger is paid to break the patch.",
  },
  {
    title: "The model's words, signed in an enclave",
    body: "Live patches come from a model in NEAR AI's TEE, signed by an attested key.",
  },
  {
    title: "The vault checks the signature itself",
    body: "The contract recovers the signer on chain and refuses any unregistered key.",
  },
];

const rows = (inference: ChainInference) => [
  { label: "Model", value: inference.model },
  { label: "Enclave signer", value: inference.signer },
  { label: "Request sha256", value: inference.request_hash },
  { label: "Reply sha256", value: inference.response_hash },
  { label: "Patch sha256", value: inference.artifact_hash },
];

function Readout({ reading }: { readonly reading: Reading<ChainInference> }) {
  if (reading.status === "loading")
    return <p className="font-mono text-[12px] text-white/50">reading vault.get_inference…</p>;
  if (reading.status === "failed")
    return (
      <p className="font-mono text-[12px] text-refused">NEAR RPC unreachable: {reading.message}</p>
    );
  return (
    <ul className="divide-y divide-white/10 border-y border-white/10">
      {rows(reading.value).map((row) => (
        <li
          key={row.label}
          className="grid grid-cols-[110px_1fr] gap-4 py-3 text-[12px] sm:grid-cols-[140px_1fr]"
        >
          <span className="text-white/50">{row.label}</span>
          <span className="truncate font-mono text-white/90">{row.value}</span>
        </li>
      ))}
      <li className="flex items-center justify-between py-3 text-[12px]">
        <span className="text-white/50">Verdict</span>
        <span className="font-mono text-ok">ACCEPT · signature verified on chain</span>
      </li>
    </ul>
  );
}

export function Verify() {
  const reading = useVaultView(
    "get_inference",
    { task_id: liveRun.taskId, attempt: 2 },
    inferenceSchema,
  );
  return (
    <section
      id="verify"
      className="mx-auto grid max-w-[1440px] items-center gap-12 px-4 py-20 sm:px-10 lg:grid-cols-[1fr_1.6fr]"
    >
      <div className="max-w-md lg:order-1">
        <p className="text-[13px] text-ash">Verify</p>
        <h2 className="mt-4 text-[26px] leading-tight font-medium tracking-tight text-balance">
          Paid only when the verifier, the enclave and the vault agree.
        </h2>
        <div className="mt-7 flex flex-wrap gap-2">
          <Pill to={enclaveKey.explorer}>See the enclave key on NEAR</Pill>
          <Pill to={`${repository}#verify-every-claim`} tone="ghost-dark">
            Re-check every claim
          </Pill>
        </div>
        <Accordion folds={folds} />
      </div>
      <div className="relative flex min-h-[460px] items-center overflow-hidden bg-ink lg:order-2">
        <div className="photo photo-verify absolute inset-y-0 right-0 w-1/6" />
        <div className="relative w-[80%] px-6 py-14 sm:px-12">
          <p className="font-mono text-[11px] tracking-wider text-white/40 uppercase">
            vault.get_inference · {liveRun.taskId} · attempt 2
          </p>
          <p className="mt-2 mb-6 text-[20px] text-white">A live AI patch, accepted on chain</p>
          <Readout reading={reading} />
          {reading.status === "ok" && (
            <p className="mt-4 font-mono text-[11px] text-white/40">
              read from NEAR testnet at {reading.readAt.toLocaleTimeString()}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
