import { BuiltOnNear } from "../components/BuiltOnNear.js";
import { Pill } from "../components/Pill.js";

export function Hero() {
  return (
    <section className="photo photo-hero relative mx-1.5 mt-14 flex min-h-[calc(100svh-3.5rem)] flex-col items-center justify-center overflow-hidden px-4 text-center text-white sm:mx-2.5">
      <div className="absolute inset-0 bg-black/30" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_38%_at_center,rgba(0,0,0,0.6),transparent)]" />
      <div className="relative flex flex-col items-center">
        <span className="mb-10 h-24 w-px bg-white/30" />
        <h1 className="rise font-serif text-[40px] leading-[1.06] sm:text-[56px] lg:text-[64px]">
          Agents can fail.
          <br />
          Their commitments should not.
        </h1>
        <div className="mt-9 flex flex-wrap justify-center gap-2">
          <Pill to="/app/replay" tone="light">
            Watch a recovery
          </Pill>
          <Pill to="#verify" tone="ghost">
            Verify it on NEAR
          </Pill>
        </div>
        <span className="mt-10 h-24 w-px bg-white/30" />
      </div>
      <BuiltOnNear tone="light" className="absolute top-6 left-6 h-4 sm:top-8 sm:left-8 sm:h-5" />
      <p className="absolute bottom-10 max-w-sm px-4 text-[14px] leading-relaxed text-white/85">
        Guarantees for AI agent work. A swarm finishes what an agent drops, and NEAR pays exactly
        once.
      </p>
    </section>
  );
}
