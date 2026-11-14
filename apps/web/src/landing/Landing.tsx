import { Footer } from "../components/Footer.js";
import { Nav } from "../components/Nav.js";
import { Attacks } from "./Attacks.js";
import { BuiltOn } from "./BuiltOn.js";
import { Closing } from "./Closing.js";
import { Hero } from "./Hero.js";
import { Recover } from "./Recover.js";
import { Settlement } from "./Settlement.js";
import { Verify } from "./Verify.js";

export function Landing() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <BuiltOn />
        <Recover />
        <Verify />
        <Attacks />
        <Settlement />
        <Closing />
      </main>
      <Footer />
    </>
  );
}
