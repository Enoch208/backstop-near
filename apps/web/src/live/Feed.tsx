import { useEffect, useRef } from "react";
import type { FeedEvent } from "./api.js";

const tone = (type: string) => {
  if (/failed|rejected|expired|terminal/.test(type)) return "text-refused";
  if (/accepted|settled|confirmed|verification_recorded|resolved/.test(type)) return "text-ok";
  if (/bid|coalition|endorse|awarded|assigned/.test(type)) return "text-[#e8c07a]";
  return "text-white/70";
};

export function Feed({ events }: { readonly events: readonly FeedEvent[] }) {
  const end = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [events.length]);
  return (
    <div className="flex min-h-0 flex-col bg-coal">
      <p className="border-b border-white/10 px-4 py-3 font-mono text-[11px] tracking-wider text-white/40 uppercase">
        Event log · {events.length} facts
      </p>
      <ol className="min-h-0 flex-1 overflow-y-auto px-4 py-3 font-mono text-[12px] leading-6">
        {events
          .filter((event) => event.body.type !== "heartbeat_recorded")
          .map((event) => (
            <li key={event.version} className="rise grid grid-cols-[44px_120px_1fr] gap-2">
              <span className="text-white/30">v{String(event.version).padStart(2, "0")}</span>
              <span className="truncate text-white/50">{event.actor}</span>
              <span className={tone(event.body.type)}>{event.body.type}</span>
            </li>
          ))}
        <li ref={end} />
      </ol>
    </div>
  );
}
