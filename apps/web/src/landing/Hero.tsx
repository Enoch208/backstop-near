import { Pill } from "../components/Pill.js";

export function Hero() {
  return (
    <section className="photo photo-hero relative flex min-h-[100svh] flex-col items-center justify-center overflow-hidden px-4 pt-14 text-center text-paper">
      <div className="absolute inset-0 bg-black/35" />
      <div className="relative flex flex-col items-center">
        <span className="mb-10 h-24 w-px bg-white/30" />
        <h1 className="rise font-serif text-[44px] leading-[1.02] tracking-[-0.01em] sm:text-[72px] lg:text-[88px]">
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
        Collateral-backed guarantees for AI agent work. When an agent dies, a swarm finishes the
        job; when the work is proven, a NEAR contract pays exactly once.
      </p>
    </section>
  );
}
