import { Pill } from "../components/Pill.js";

export function Hero() {
  return (
    <section className="photo photo-hero relative flex min-h-[100svh] flex-col items-center justify-center overflow-hidden px-4 pt-14 text-center text-paper">
      <div className="absolute inset-0 bg-black/30" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_38%_at_center,rgba(0,0,0,0.6),transparent)]" />
      <div className="relative flex flex-col items-center">
        <span className="mb-10 h-24 w-px bg-white/30" />
        <h1 className="rise font-serif text-[44px] leading-[1.04] sm:text-[64px] lg:text-[76px]">
          Agents can fail.
          <br />
          Their commitments should not.
        </h1>
        <div className="mt-9 flex flex-wrap justify-center gap-2">
          <Pill to="/live" tone="light">
            Watch a recovery
          </Pill>
          <Pill to="#verify" tone="ghost">
            Verify it on NEAR
          </Pill>
        </div>
        <span className="mt-10 h-24 w-px bg-white/30" />
      </div>
      <p className="absolute bottom-10 max-w-md px-4 text-[14px] leading-relaxed text-white/80">
        Guarantees for AI agent work. A swarm finishes what an agent drops, and NEAR pays exactly
        once.
      </p>
    </section>
  );
}
