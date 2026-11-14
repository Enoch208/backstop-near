import { Link } from "react-router";
import { enclaveKey, liveRun, nearblocksAccount, record, repository } from "../data/record.js";
import { asset } from "../data/base.js";
import { Bars } from "./Bars.js";
import { BuiltOnNear } from "./BuiltOnNear.js";

type Item = { readonly label: string; readonly to: string };

const outside: readonly Item[] = [
  { label: "GitHub", to: repository },
  { label: "The vault on NEAR", to: nearblocksAccount(record.contractId) },
  { label: "Enclave key", to: enclaveKey.explorer },
];

const inside: readonly Item[] = [
  { label: "Watch it live", to: "/live" },
  { label: "How it works", to: asset("#recover") },
  { label: "Verify", to: asset("#verify") },
  { label: "Settlement", to: asset("#settlement") },
  { label: "Testnet record", to: `${repository}/blob/main/deployments/testnet.json` },
  { label: "Contract", to: `${repository}/tree/main/contracts/outcome-vault` },
];

const legal: readonly Item[] = [
  { label: "MIT License", to: `${repository}/blob/main/LICENSE` },
  { label: `Run ${liveRun.taskId}`, to: liveRun.steps.at(-2)?.explorer ?? repository },
];

function Links({ items }: { readonly items: readonly Item[] }) {
  return (
    <ul className="space-y-1 text-[16px]">
      {items.map((item) => (
        <li key={item.label}>
          {item.to.startsWith("http") || item.to.includes("#") ? (
            <a href={item.to} target="_blank" rel="noreferrer" className="hover:text-white/70">
              {item.label}
            </a>
          ) : (
            <Link to={item.to} className="hover:text-white/70">
              {item.label}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}

export function Footer() {
  return (
    <footer className="mt-1.5 bg-ink text-white">
      <div className="grid gap-10 px-4 pt-32 sm:px-10 md:grid-cols-[2fr_1fr_1fr]">
        <Links items={outside} />
        <Links items={inside} />
        <Links items={legal} />
      </div>
      <div className="grid gap-4 px-4 pt-28 pb-12 text-[12px] sm:px-10 md:grid-cols-[2fr_2fr]">
        <span className="flex flex-wrap items-center gap-5">
          <BuiltOnNear tone="light" className="h-5" />
          <span>Built at NEAR HACKATHON 2026</span>
        </span>
        <span className="text-white/50">
          Testnet only. Not insurance and not a promise of success.
        </span>
      </div>
      <Bars seed={record.contractId} count={96} className="block h-56 w-full" />
    </footer>
  );
}
