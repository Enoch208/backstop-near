import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { Mark } from "../components/Mark.js";
import { nearblocksAccount, record, repository } from "../data/record.js";
import { Icon, type IconName } from "./icons.js";
import { Chip } from "./ui.js";

type Item = { readonly label: string; readonly to: string; readonly icon: IconName };

const groups: readonly { readonly title: string | null; readonly items: readonly Item[] }[] = [
  {
    title: null,
    items: [
      { label: "Overview", to: "/app", icon: "overview" },
      { label: "Repair a function", to: "/app/repair", icon: "code" },
      { label: "Mission Control", to: "/app/live", icon: "live" },
      { label: "Runs", to: "/app/runs", icon: "runs" },
    ],
  },
  {
    title: "Proof",
    items: [
      { label: "Verify", to: "/app/verify", icon: "verify" },
      { label: "Arena", to: "/app/arena", icon: "arena" },
    ],
  },
];

const outside: readonly {
  readonly label: string;
  readonly href: string;
  readonly icon: IconName;
}[] = [
  { label: "Vault contract", href: nearblocksAccount(record.contractId), icon: "vault" },
  { label: "Source code", href: repository, icon: "code" },
];

const sections: Record<string, string> = {
  repair: "Repair a function",
  live: "Mission Control",
  runs: "Runs",
  verify: "Verify",
  arena: "Arena",
};

const itemClass = ({ isActive }: { readonly isActive: boolean }) =>
  `flex h-9 items-center gap-3 rounded-full px-3 text-[14px] tracking-[-0.02em] transition-colors duration-150 ${isActive ? "bg-surface font-medium text-ink" : "text-ink/60 hover:text-ink"}`;

function Navigation() {
  return (
    <nav className="flex flex-1 flex-col gap-6">
      {groups.map((group) => (
        <div key={group.title ?? "main"} className="flex flex-col gap-0.5">
          {group.title !== null && <p className="eyebrow px-3 pb-2 text-ink/40">{group.title}</p>}
          {group.items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === "/app"} className={itemClass}>
              <Icon name={item.icon} />
              {item.label}
            </NavLink>
          ))}
        </div>
      ))}
      <div className="flex flex-col gap-0.5">
        <p className="eyebrow px-3 pb-2 text-ink/40">NEAR testnet</p>
        {outside.map((link) => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noreferrer"
            className="flex h-9 items-center gap-3 rounded-full px-3 text-[14px] tracking-[-0.02em] text-ink/60 transition-colors duration-150 hover:text-ink"
          >
            <Icon name={link.icon} />
            <span className="flex-1">{link.label}</span>
            <Icon name="external" size={14} />
          </a>
        ))}
      </div>
      <div className="mt-auto flex flex-col gap-3 px-3">
        <Link
          to="/"
          className="flex items-center gap-3 text-[14px] tracking-[-0.02em] text-ink/60 hover:text-ink"
        >
          <Icon name="home" />
          Back to the site
        </Link>
        <p
          className="truncate font-mono text-[11px] leading-[1.4] text-ink/40"
          title={record.contractId}
        >
          {record.contractId}
        </p>
      </div>
    </nav>
  );
}

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2 px-3">
      <Mark className="h-5 w-5" />
      <span className="font-serif text-[22px] leading-none">Backstop</span>
    </Link>
  );
}

function Crumbs() {
  const { pathname } = useLocation();
  const parts = pathname.split("/").filter((part) => part !== "" && part !== "app");
  const section = parts[0];
  const crumbs = [
    { label: "Overview", to: "/app" },
    ...(section === undefined
      ? []
      : [{ label: sections[section] ?? section, to: `/app/${section}` }]),
    ...parts.slice(1).map((part) => ({ label: decodeURIComponent(part), to: pathname })),
  ];
  return (
    <ol className="flex min-w-0 items-center gap-2 text-[14px] tracking-[-0.02em]">
      {crumbs.map((crumb, index) => (
        <li key={`${crumb.to}-${crumb.label}`} className="flex min-w-0 items-center gap-2">
          {index > 0 && <span className="text-ink/30">/</span>}
          {index === crumbs.length - 1 ? (
            <span className="truncate font-medium">{crumb.label}</span>
          ) : (
            <Link to={crumb.to} className="truncate text-ink/60 hover:text-ink">
              {crumb.label}
            </Link>
          )}
        </li>
      ))}
    </ol>
  );
}

export function AppLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  const step =
    "flex h-8 w-8 items-center justify-center rounded-full text-ink/60 hover:bg-surface hover:text-ink";
  return (
    <div className="min-h-screen bg-page text-ink lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <aside className="hidden h-screen flex-col gap-8 px-3 py-5 lg:sticky lg:top-0 lg:flex">
        <Brand />
        <Navigation />
      </aside>
      <div className="min-w-0">
        <header className="glass sticky top-0 z-40 flex h-14 items-center gap-2 px-4 sm:px-6 lg:px-8">
          <button
            type="button"
            aria-label="Open navigation"
            onClick={() => {
              setOpen(true);
            }}
            className={`${step} lg:hidden`}
          >
            <Icon name="menu" />
          </button>
          <button
            type="button"
            aria-label="Go back"
            onClick={() => {
              void navigate(-1);
            }}
            className={`${step} hidden sm:flex`}
          >
            <Icon name="back" />
          </button>
          <button
            type="button"
            aria-label="Go forward"
            onClick={() => {
              void navigate(1);
            }}
            className={`${step} hidden sm:flex`}
          >
            <Icon name="forward" />
          </button>
          <div className="ml-1 min-w-0 flex-1">
            <Crumbs />
          </div>
          <Chip tone="pass">NEAR testnet</Chip>
        </header>
        <main className="mx-auto w-full max-w-[1200px] px-4 pt-6 pb-16 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => {
              setOpen(false);
            }}
            className="absolute inset-0 bg-ink/20"
          />
          <aside className="relative flex h-full w-[272px] flex-col gap-8 bg-page px-3 py-5">
            <div className="flex items-center justify-between">
              <Brand />
              <button
                type="button"
                aria-label="Close navigation"
                onClick={() => {
                  setOpen(false);
                }}
                className={step}
              >
                <Icon name="close" />
              </button>
            </div>
            <Navigation />
          </aside>
        </div>
      )}
    </div>
  );
}
