import { Hero } from "../components/Hero";
import { Ticker } from "../components/Ticker";
import { DeltaPlayground } from "../components/DeltaPlayground";
import { HowItWorks } from "../components/HowItWorks";
import { Vaults } from "../components/Vaults";
import { Honest } from "../components/Honest";
import { Safety } from "../components/Safety";
import { FAQ } from "../components/FAQ";

export function Landing() {
  return (
    <main>
      <Hero />
      <Ticker />
      <DeltaPlayground />
      <HowItWorks />
      <Vaults />
      <Honest />
      <Safety />
      <FAQ />
    </main>
  );
}
