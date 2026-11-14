import { Pill } from "../components/Pill.js";
import { repository } from "../data/record.js";

export function Closing() {
  return (
    <section className="photo photo-closing relative mx-1.5 flex min-h-[85svh] flex-col items-center justify-end overflow-hidden px-4 pb-24 text-center sm:mx-2.5">
      <h2 className="font-serif text-[44px] leading-none text-white sm:text-[72px]">
        Every commitment needs a backstop.
      </h2>
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <Pill to="/app/replay" tone="light">
          Watch it live
        </Pill>
        <Pill to={repository} tone="ghost">
          Read the code
        </Pill>
      </div>
    </section>
  );
}
