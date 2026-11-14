import { Link } from "react-router";
import { enclaveKey, liveRun, nearblocksAccount, record, repository } from "../data/record.js";
import { Bars } from "./Bars.js";
import { Mark } from "./Mark.js";

const columns = [
  {
    title: "Product",
    links: [
      { label: "Watch it live", to: "/live" },
      { label: "How it works", to: "/#recover" },
      { label: "Verify every claim", to: "/#verify" },
    ],
  },
  {
    title: "Code",
    links: [
      { label: "Repository", to: repository },
      { label: "Testnet record", to: `${repository}/blob/main/deployments/testnet.json` },
      { label: "Contract", to: `${repository}/tree/main/contracts/outcome-vault` },
    ],
  },
  {
    title: "On NEAR",
    links: [
      { label: "The vault", to: nearblocksAccount(record.contractId) },
      { label: "Enclave key registration", to: enclaveKey.explorer },
      { label: `Run ${liveRun.taskId}`, to: liveRun.steps.at(-2)?.explorer ?? repository },
    ],
  },
];

export function Footer() {
  return (
    <footer className="bg-ink text-paper">
      <div className="mx-auto grid max-w-[1440px] gap-10 px-4 pt-24 pb-14 sm:px-10 md:grid-cols-4">
        <div className="flex items-start gap-2">
          <Mark className="h-5 w-5" />
          <span className="font-serif text-[24px] leading-none">Backstop</span>
        </div>
        {columns.map((column) => (
          <div key={column.title}>
            <p className="mb-4 font-mono text-[11px] tracking-wider text-ash uppercase">
              {column.title}
            </p>
            <ul className="space-y-1.5 text-[15px]">
              {column.links.map((link) => (
                <li key={link.label}>
                  {link.to.startsWith("http") ? (
                    <a href={link.to} target="_blank" rel="noreferrer" className="hover:text-ok">
                      {link.label}
                    </a>
                  ) : (
                    <Link to={link.to} className="hover:text-ok">
                      {link.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto flex max-w-[1440px] flex-wrap justify-between gap-4 px-4 pb-10 text-[12px] text-ash sm:px-10">
        <span>Built at NEAR HACKATHON 2026 · MIT licensed</span>
        <span>Testnet only. Not insurance and not a promise of success.</span>
      </div>
      <Bars seed={record.contractId} className="block h-48 w-full" />
    </footer>
  );
}
