import { Hero } from "../components/Hero";
import { Ticker } from "../components/Ticker";
import { Products } from "../components/Products";
import { HowItWorks } from "../components/HowItWorks";
import { Honest } from "../components/Honest";
import { Safety } from "../components/Safety";
import { FAQ } from "../components/FAQ";
import { Waitlist } from "../components/Waitlist";

export function Landing() {
  return (
    <main>
      <Hero />
      <Ticker />
      <Products />
      <HowItWorks />
      <Honest />
      <Safety />
      <Waitlist />
      <FAQ />
    </main>
  );
}
