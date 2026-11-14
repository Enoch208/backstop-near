import { Bars } from "../components/Bars.js";

const attacks = [
  {
    code: "STALE_LEASE",
    title: "A killed worker comes back",
    body: "Its late writes carry an old fencing token and are refused.",
    by: "Fenced leases",
  },
  {
    code: "ERR_ALREADY_SETTLED",
    title: "Someone settles twice",
    body: "One settlement key per task. The second attempt fails on chain.",
    by: "The vault contract",
  },
  {
    code: "ERR_UNKNOWN_TEE_SIGNER",
    title: "An agent forges an AI receipt",
    body: "Unregistered keys and swapped code are both refused.",
    by: "ecrecover in the vault",
  },
  {
    code: "MethodNameMismatch",
    title: "The coordinator's key leaks",
    body: "Role keys can call their own vault methods and nothing else.",
    by: "NEAR access keys",
  },
];

export function Attacks() {
  return (
    <section className="bg-ink text-paper">
      <div className="mx-auto grid max-w-[1440px] gap-10 px-4 pt-24 sm:px-10 lg:grid-cols-[1fr_2fr]">
        <h2 className="text-[28px] tracking-tight">Attacks it refuses</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {attacks.map((attack) => (
            <article key={attack.code} className="flex min-h-80 flex-col bg-graphite p-7">
              <p className="font-mono text-[12px] text-refused">{attack.code}</p>
              <h3 className="mt-auto text-[17px]">{attack.title}</h3>
              <p className="mt-2 text-[14px] leading-relaxed text-white/60">{attack.body}</p>
              <p className="mt-6 text-[12px] text-white/40">Refused by {attack.by}</p>
            </article>
          ))}
        </div>
      </div>
      <Bars seed="attacks" count={64} className="mt-16 block h-40 w-full" />
    </section>
  );
}
