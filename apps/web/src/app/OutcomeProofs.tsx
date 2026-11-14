import { Link } from "react-router";
import { recoveryProofId, refundProofId, repository } from "../data/record.js";
import { buttonClass, Panel } from "./ui.js";

export function OutcomeProofs() {
  return (
    <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Panel title="1. Work recovered and paid" meta="captured live AI · NEAR testnet">
        <p className="text-[14px] leading-relaxed text-ink/70">
          The primary process was killed. A recovery worker produced a patch, the verifier accepted
          it, and the vault settled 0.69 NEAR. The worker received 0.0625 NEAR; the customer
          received 0.3775 NEAR back and the guarantor received its 0.25 NEAR bond.
        </p>
        <Link to={`/app/runs/${recoveryProofId}`} className={`${buttonClass.primary} mt-4`}>
          Replay recovery and inspect payouts
        </Link>
      </Panel>
      <Panel title="2. Failed task refunded" meta="expired-task proof · NEAR testnet">
        <p className="text-[14px] leading-relaxed text-ink/70">
          Recovery expired without delivery. An observer triggered the refund without the
          coordinator: 0.05 NEAR returned to the customer, with a repeated refund refused. This task
          had no bond, so compensation was 0 NEAR. Bond-backed compensation is capped by the funded
          policy and remaining liability; this recording proves the refund path.
        </p>
        <Link to={`/app/runs/${refundProofId}`} className={`${buttonClass.secondary} mt-4`}>
          Inspect failure and refund
        </Link>
      </Panel>
      <p className="text-[12px] leading-relaxed text-ink/60 lg:col-span-2">
        These are recorded testnet outcomes with team-controlled workers. The interactive Mission
        Control demo uses scripted repairs and a simulated vault. Acceptance means the pinned checks
        passed; an enclave receipt proves inference provenance, not universal correctness. For the
        capped-compensation fixture, run <code>pnpm episode exhausted</code> with simulated funds.{" "}
        <a
          href={`${repository}/blob/main/docs/independent-reproduction.md`}
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          Reproduce both outcomes
        </a>
        .
      </p>
    </div>
  );
}
