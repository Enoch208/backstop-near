const rows = [
  [
    "NEAR Protocol",
    "NEAR AI Cloud",
    "NEAR Intents",
    "Intel TDX",
    "NVIDIA NRAS",
    "near-sdk",
    "MCP",
    "Rust",
  ],
  ["Function-call keys", "ecrecover", "EIP-191", "DCAP", "TypeScript", "zod", "Vitest", "neard"],
];

function Row({ names, reverse }: { readonly names: readonly string[]; readonly reverse: boolean }) {
  return (
    <div className="overflow-hidden">
      <div className={`flex w-max gap-1.5 ${reverse ? "drift-reverse" : "drift"}`}>
        {[...names, ...names].map((name, index) => (
          <div
            key={`${name}-${String(index)}`}
            className="flex h-[104px] w-[180px] shrink-0 items-center justify-center bg-tile px-4 text-center text-[19px] font-semibold tracking-tight text-ink/80"
          >
            {name}
          </div>
        ))}
      </div>
    </div>
  );
}

export function BuiltOn() {
  return (
    <section className="space-y-1.5 py-1.5" aria-label="Built on">
      {rows.map((names, index) => (
        <Row key={names[0]} names={names} reverse={index === 1} />
      ))}
    </section>
  );
}
