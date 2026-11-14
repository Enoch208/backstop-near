import { Link } from "react-router";
import { asset } from "../data/base.js";
import { repository } from "../data/record.js";
import { Mark } from "./Mark.js";
import { Pill } from "./Pill.js";

const links = [
  { label: "How it works", to: asset("#recover") },
  { label: "Verify it yourself", to: asset("verify") },
  { label: "Settlement", to: asset("#settlement") },
  { label: "GitHub", to: repository },
];

export function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50 bg-white">
      <div className="relative flex h-14 items-center justify-between px-4 sm:px-10">
        <Link to="/" className="flex items-center gap-2 text-[20px] tracking-tight">
          <Mark className="h-5 w-5" />
          <span className="font-serif text-[24px] leading-none">Backstop</span>
        </Link>
        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-7 text-[13px] md:flex">
          {links.map((link) =>
            link.to.startsWith("http") ? (
              <a key={link.label} href={link.to} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            ) : (
              <a key={link.label} href={link.to}>
                {link.label}
              </a>
            ),
          )}
        </nav>
        <Pill to="/live">Watch it live</Pill>
      </div>
    </header>
  );
}
