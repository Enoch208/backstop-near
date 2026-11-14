import type { ReactNode } from "react";

export type Tone = "pass" | "warn" | "fail" | "info" | "neutral";

const chipTones: Record<Tone, string> = {
  pass: "bg-pass-bg text-pass",
  warn: "bg-warn-bg text-warn",
  fail: "bg-fail-bg text-fail",
  info: "bg-info-bg text-info",
  neutral: "bg-ink/[0.06] text-ink/70",
};

export const textTones: Record<Tone, string> = {
  pass: "text-pass",
  warn: "text-warn",
  fail: "text-fail",
  info: "text-info",
  neutral: "text-ink/60",
};

export function Chip({
  tone = "neutral",
  children,
}: {
  readonly tone?: Tone;
  readonly children: ReactNode;
}) {
  return (
    <span
      className={`eyebrow inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2 whitespace-nowrap ${chipTones[tone]}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  readonly eyebrow: string;
  readonly title: ReactNode;
  readonly subtitle: ReactNode;
  readonly actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-6 pt-2 pb-8 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-[640px]">
        <p className="eyebrow text-ink/60">{eyebrow}</p>
        <h1 className="mt-4 text-[24px] leading-[1.1] font-medium tracking-[-0.04em] text-balance sm:text-[32px]">
          {title}
        </h1>
        <p className="mt-3 text-[14px] leading-[1.5] tracking-[-0.01em] text-pretty text-ink/60 sm:text-[15px]">
          {subtitle}
        </p>
      </div>
      {actions !== undefined && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({
  title,
  meta,
  children,
  className = "",
  flush = false,
}: {
  readonly title: string;
  readonly meta?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  readonly flush?: boolean;
}) {
  return (
    <section className={`flex min-w-0 flex-col rounded-[24px] bg-surface ${className}`}>
      <header className="flex items-center justify-between gap-4 px-6 pt-5 pb-3">
        <h2 className="text-[15px] leading-[1.2] font-medium tracking-[-0.02em]">{title}</h2>
        {meta !== undefined && <div className="eyebrow text-ink/50">{meta}</div>}
      </header>
      <div className={flush ? "min-h-0 flex-1" : "min-h-0 flex-1 px-6 pb-6"}>{children}</div>
    </section>
  );
}

export function Kpi({
  label,
  value,
  unit,
  note,
  primary = false,
}: {
  readonly label: string;
  readonly value: ReactNode;
  readonly unit?: string;
  readonly note: ReactNode;
  readonly primary?: boolean;
}) {
  return (
    <div
      className={`flex min-w-0 flex-col justify-between gap-6 rounded-xl p-4 sm:p-5 ${primary ? "bg-ink text-white" : "bg-surface"}`}
    >
      <p className="text-[13px] leading-[1.3] font-medium tracking-[-0.02em]">{label}</p>
      <div>
        <p className="truncate text-[28px] leading-[1.12] font-medium tracking-[-0.04em] tabular-nums sm:text-[32px]">
          {value}
          {unit !== undefined && (
            <span
              className={`ml-1.5 text-[14px] tracking-[-0.02em] ${primary ? "text-white/60" : "text-ink/50"}`}
            >
              {unit}
            </span>
          )}
        </p>
        <p
          className={`mt-1.5 line-clamp-2 text-[12px] leading-[1.3] ${primary ? "text-white/60" : "text-ink/60"}`}
        >
          {note}
        </p>
      </div>
    </div>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly value: T;
  readonly onChange: (next: T) => void;
  readonly label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex h-9 items-center rounded-full bg-surface p-1"
    >
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => {
            onChange(option.value);
          }}
          className={`h-7 rounded-full px-3 text-[13px] font-medium tracking-[-0.02em] transition-colors duration-150 ${option.value === value ? "bg-ink text-white" : "text-ink/60 hover:text-ink"}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export const buttonClass = {
  primary:
    "inline-flex h-9 items-center gap-2 rounded-full bg-ink px-4 text-[13px] font-medium tracking-[-0.02em] text-white transition-colors duration-150 hover:bg-graphite",
  secondary:
    "inline-flex h-9 items-center gap-2 rounded-full bg-surface px-4 text-[13px] font-medium tracking-[-0.02em] text-ink transition-colors duration-150 hover:bg-well",
};

export function Empty({ children }: { readonly children: ReactNode }) {
  return <p className="py-2 text-[13px] leading-[1.5] text-ink/50">{children}</p>;
}
