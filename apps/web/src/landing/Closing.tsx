import { Pill } from "../components/Pill.js";
import { repository } from "../data/record.js";

export function Closing() {
  return (
    <section className="photo photo-closing relative flex min-h-[80svh] flex-col items-center justify-end overflow-hidden px-4 pb-24 text-center">
      <h2 className="font-serif text-[48px] leading-none text-paper sm:text-[84px]">
        Every commitment needs a backstop.
      </h2>
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <Pill to="/live" tone="light">
          Watch it live
        </Pill>
        <Pill to={repository} tone="ghost">
          Read the code
        </Pill>
      </div>
    </section>
  );
}
