import { useState } from "react";

export type Fold = { readonly title: string; readonly body: string };

export function Accordion({
  folds,
  dark = false,
}: {
  readonly folds: readonly Fold[];
  readonly dark?: boolean;
}) {
  const [open, setOpen] = useState(0);
  const rule = dark ? "border-white/15" : "border-ink/10";
  return (
    <div className="mt-10">
      {folds.map((fold, index) => {
        const active = index === open;
        return (
          <button
            key={fold.title}
            type="button"
            onClick={() => {
              setOpen(index);
            }}
            className={`block w-full border-t py-5 text-left ${rule} ${index === 0 ? (dark ? "border-t-white" : "border-t-ink") + " border-t-2" : ""}`}
          >
            <span className={`text-[16px] ${active ? "" : "text-ash"}`}>{fold.title}</span>
            {active && (
              <span
                className={`rise mt-2 block max-w-md text-[14px] leading-relaxed ${dark ? "text-white/60" : "text-ash"}`}
              >
                {fold.body}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
