import type { ReactNode } from "react";
import { Link } from "react-router";

type Tone = "dark" | "light" | "ghost" | "ghost-dark";

const tones: Record<Tone, string> = {
  dark: "bg-ink text-paper hover:bg-graphite",
  light: "bg-paper text-ink hover:bg-white",
  ghost: "border border-white/30 text-paper hover:border-white/70",
  "ghost-dark": "border border-ink/20 text-ink hover:border-ink/60",
};

export function Pill({
  to,
  tone = "dark",
  children,
}: {
  readonly to: string;
  readonly tone?: Tone;
  readonly children: ReactNode;
}) {
  const className = `inline-flex items-center rounded-full px-4 py-2 text-[13px] font-medium transition-colors ${tones[tone]}`;
  if (to.startsWith("http"))
    return (
      <a href={to} target="_blank" rel="noreferrer" className={className}>
        {children}
      </a>
    );
  if (to.startsWith("#"))
    return (
      <a href={to} className={className}>
        {children}
      </a>
    );
  return (
    <Link to={to} className={className}>
      {children}
    </Link>
  );
}
