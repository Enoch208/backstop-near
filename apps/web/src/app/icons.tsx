import type { ReactNode } from "react";

export type IconName =
  | "overview"
  | "live"
  | "runs"
  | "verify"
  | "arena"
  | "vault"
  | "code"
  | "external"
  | "back"
  | "forward"
  | "home"
  | "menu"
  | "close";

const shapes: Record<IconName, ReactNode> = {
  overview: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </>
  ),
  live: <path d="M3 12h4l2.5-6 5 12 2.5-6h4" />,
  runs: (
    <>
      <path d="M8 6.5h12M8 12h12M8 17.5h12" />
      <circle cx="4.25" cy="6.5" r="0.75" />
      <circle cx="4.25" cy="12" r="0.75" />
      <circle cx="4.25" cy="17.5" r="0.75" />
    </>
  ),
  verify: (
    <>
      <path d="M12 3.5 5 6v5.5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </>
  ),
  arena: <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />,
  vault: (
    <>
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9z" />
      <path d="m4 7.5 8 4.5 8-4.5M12 12v9" />
    </>
  ),
  code: <path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5" />,
  external: <path d="M8 16 16 8M9.5 8H16v6.5" />,
  back: <path d="m14.5 6-6 6 6 6" />,
  forward: <path d="m9.5 6 6 6-6 6" />,
  home: <path d="M19 12H5M11 6l-6 6 6 6" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
};

export function Icon({ name, size = 18 }: { readonly name: IconName; readonly size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {shapes[name]}
    </svg>
  );
}
