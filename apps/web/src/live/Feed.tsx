import { Empty, Panel, textTones, type Tone } from "../app/ui.js";
import { nearAmount } from "../data/near.js";
import { z } from "zod";
import type { AgentLine, FeedEvent } from "./api.js";
import { useStickToBottom } from "./stick.js";

const eventTone = (type: string): Tone => {
  if (type === "finding_recorded") return "info";
  if (/failed|rejected|expired|terminal/.test(type)) return "fail";
  if (/accepted|settled|confirmed|verification_recorded|resolved/.test(type)) return "pass";
  if (/bid|coalition|endorse|awarded|assigned/.test(type)) return "warn";
  return "neutral";
};

const lineTone = (line: string): Tone => {
  if (/^pricing:/.test(line)) return "warn";
  if (/error|failed|stopped|declined|altered/.test(line)) return "fail";
  if (/finding|diagnos/.test(line)) return "info";
  if (/resumed|hash verified|claimed|submitted|settled/.test(line)) return "pass";
  return "neutral";
};

const scroller = "scroll-thin h-[340px] overflow-y-auto px-6 pb-5 sm:h-[380px]";

const submittedBid = z.object({
  bid: z.object({ amountYocto: z.string().regex(/^\d+$/), epoch: z.number() }),
  bidHash: z.string(),
});

export function RecoveryBids({ events }: { readonly events: readonly FeedEvent[] }) {
  const bids = events.flatMap(({ actor, body }) => {
    if (body.type !== "bid_submitted") return [];
    const signed = submittedBid.safeParse(body.bid);
    return !signed.success || signed.data.bid.epoch === 0 ? [] : [{ actor, ...signed.data }];
  });
  const latest = bids.at(-1)?.bid.epoch;
  if (latest === undefined) return null;
  const award = events.find(
    ({ body }) => body.type === "recovery_awarded" && body.epoch === latest,
  );
  return (
    <Panel title="Recovery bids" meta={`round ${String(latest)}`}>
      <ul className="divide-y divide-ink/[0.05] text-[13px]">
        {bids
          .filter(({ bid }) => bid.epoch === latest)
          .map(({ actor, bid, bidHash }) => (
            <li key={bidHash} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="font-mono">{actor}</span>
              <span className="tabular-nums">
                {nearAmount(bid.amountYocto, 24).replace(/\.?0+$/, "")} NEAR
                {award?.body.winner === bidHash && <span className="ml-2 text-ink/55">Won</span>}
              </span>
            </li>
          ))}
      </ul>
    </Panel>
  );
}

export function Feed({ events }: { readonly events: readonly FeedEvent[] }) {
  const shown = events.filter((event) => event.body.type !== "heartbeat_recorded");
  const ref = useStickToBottom(shown.length);
  return (
    <Panel title="Event log" meta={`${String(events.length)} facts`} flush>
      <div ref={ref} className={scroller}>
        {shown.length === 0 && <Empty>No events yet.</Empty>}
        <ol className="font-mono text-[12px] leading-[1.5]">
          {shown.map((event) => (
            <li
              key={event.version}
              className="rise grid grid-cols-[36px_88px_minmax(0,1fr)] gap-3 border-b border-ink/[0.05] py-2 last:border-0 sm:grid-cols-[40px_120px_minmax(0,1fr)]"
            >
              <span className="text-ink/35 tabular-nums">
                v{String(event.version).padStart(2, "0")}
              </span>
              <span className="truncate text-ink/60">{event.actor}</span>
              <span className={`truncate ${textTones[eventTone(event.body.type)]}`}>
                {event.body.type}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </Panel>
  );
}

export function AgentLogs({ lines }: { readonly lines: readonly AgentLine[] }) {
  const ref = useStickToBottom(lines.length);
  return (
    <Panel title="Agent logs" meta="each process, as it decided" flush>
      <div ref={ref} className={scroller}>
        {lines.length === 0 && <Empty>No agent output in this run yet.</Empty>}
        <ol className="text-[13px] leading-[1.5] tracking-[-0.01em]">
          {lines.map((entry, index) => (
            <li
              key={index}
              className="rise grid grid-cols-[64px_minmax(0,1fr)] gap-3 border-b border-ink/[0.05] py-2 last:border-0 sm:grid-cols-[76px_minmax(0,1fr)]"
            >
              <span className="font-mono text-[12px] text-ink/50">{entry.agentId}</span>
              <span
                className={`break-words ${lineTone(entry.line) === "neutral" ? "text-ink/80" : textTones[lineTone(entry.line)]}`}
              >
                {entry.line}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </Panel>
  );
}
