const pieces = [
  { name: "NEAR Protocol", role: "settlement and callbacks" },
  { name: "NEAR AI Cloud", role: "inference in a TEE" },
  { name: "NEAR Intents", role: "cross-chain payouts" },
  { name: "Intel TDX", role: "enclave quote, checked" },
  { name: "NVIDIA NRAS", role: "GPU attestation, checked" },
  { name: "near-sdk 5.29", role: "Rust vault contract" },
  { name: "Function-call keys", role: "least privilege" },
  { name: "MCP", role: "open challenger market" },
];

export function BuiltOn() {
  return (
    <section className="mx-auto max-w-[1440px] px-4 pt-3 sm:px-10">
      <p className="mb-3 font-mono text-[11px] tracking-wider text-ash uppercase">Built on</p>
      <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
        {pieces.map((piece) => (
          <div
            key={piece.name}
            className="flex h-24 flex-col items-center justify-center bg-tile px-3 text-center"
          >
            <span className="text-[17px] font-semibold tracking-tight">{piece.name}</span>
            <span className="mt-1 font-mono text-[11px] text-ash">{piece.role}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
