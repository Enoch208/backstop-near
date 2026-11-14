function seedOf(text: string): number {
  let hash = 7;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function Bars({
  seed,
  count = 72,
  className = "",
}: {
  readonly seed: string;
  readonly count?: number;
  readonly className?: string;
}) {
  let state = seedOf(seed);
  const next = () => {
    state = (state * 1_103_515_245 + 12_345) >>> 0;
    return state / 4_294_967_296;
  };
  const bars = Array.from({ length: count }, (_, index) => {
    const wave = Math.sin((index / count) * Math.PI);
    return { body: 0.15 + wave * 0.55 + next() * 0.2, stem: 0.1 + next() * 0.25 };
  });
  return (
    <svg
      viewBox={`0 0 ${String(count * 20)} 200`}
      preserveAspectRatio="none"
      className={className}
      aria-hidden="true"
    >
      {bars.map((bar, index) => {
        const x = index * 20 + 8;
        const top = 200 - bar.body * 200;
        return (
          <g key={x}>
            <rect
              x={x + 1.5}
              y={top - bar.stem * 120}
              width="1"
              height={bar.stem * 120}
              fill="#5a5a58"
            />
            <rect
              x={x}
              y={top}
              width="4"
              height={200 - top}
              fill="#9a9a96"
              opacity={0.35 + bar.body * 0.6}
            />
          </g>
        );
      })}
    </svg>
  );
}
