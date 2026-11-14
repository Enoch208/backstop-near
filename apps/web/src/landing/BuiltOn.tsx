import {
  siGithubactions,
  siModelcontextprotocol,
  siNear,
  siNodedotjs,
  siPnpm,
  siReact,
  siRust,
  siTailwindcss,
  siTypescript,
  siVite,
  siVitest,
  siZod,
  type SimpleIcon,
} from "simple-icons";

type Tile = { readonly name: string; readonly icon: SimpleIcon | null };

const rows: readonly (readonly Tile[])[] = [
  [
    { name: "NEAR Protocol", icon: siNear },
    { name: "NEAR AI Cloud", icon: siNear },
    { name: "NEAR Intents", icon: siNear },
    { name: "Intel TDX", icon: null },
    { name: "NVIDIA NRAS", icon: null },
    { name: "Rust", icon: siRust },
    { name: "MCP", icon: siModelcontextprotocol },
    { name: "TypeScript", icon: siTypescript },
  ],
  [
    { name: "Node.js", icon: siNodedotjs },
    { name: "React", icon: siReact },
    { name: "Vite", icon: siVite },
    { name: "Vitest", icon: siVitest },
    { name: "Zod", icon: siZod },
    { name: "Tailwind CSS", icon: siTailwindcss },
    { name: "pnpm", icon: siPnpm },
    { name: "GitHub Actions", icon: siGithubactions },
  ],
];

function Logo({ tile }: { readonly tile: Tile }) {
  return (
    <div className="flex h-[104px] w-[210px] shrink-0 items-center justify-center gap-2.5 bg-tile px-4 text-ink/75">
      {tile.icon !== null && (
        <svg viewBox="0 0 24 24" className="h-6 w-6 shrink-0 fill-current" aria-hidden="true">
          <path d={tile.icon.path} />
        </svg>
      )}
      <span className="text-[18px] font-semibold tracking-tight whitespace-nowrap">
        {tile.name}
      </span>
    </div>
  );
}

function Row({ tiles, reverse }: { readonly tiles: readonly Tile[]; readonly reverse: boolean }) {
  return (
    <div className="overflow-hidden">
      <div className={`flex w-max gap-1.5 ${reverse ? "drift-reverse" : "drift"}`}>
        {[...tiles, ...tiles].map((tile, index) => (
          <Logo key={`${tile.name}-${String(index)}`} tile={tile} />
        ))}
      </div>
    </div>
  );
}

export function BuiltOn() {
  return (
    <section className="space-y-1.5 py-1.5" aria-label="Built with">
      {rows.map((tiles, index) => (
        <Row key={tiles[0]?.name ?? String(index)} tiles={tiles} reverse={index === 1} />
      ))}
    </section>
  );
}
