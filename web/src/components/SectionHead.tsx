import { Reveal } from "./Reveal";
import type { ReactNode } from "react";

/** Numbered newspaper section header with double rule. */
export function SectionHead({
  no,
  kicker,
  title,
  children,
  dark = false,
}: {
  no: string;
  kicker: string;
  title: ReactNode;
  children?: ReactNode;
  dark?: boolean;
}) {
  return (
    <Reveal>
      <div className={`rule-double pt-5 ${dark ? "border-paper" : ""}`}>
        <div className={`flex items-baseline gap-4 font-mono text-[12px] uppercase tracking-[0.2em] ${dark ? "text-dfog" : "text-fog"}`}>
          <span className={`font-bold ${dark ? "text-accent" : "text-accent"}`}>№ {no}</span>
          <span>{kicker}</span>
        </div>
        <h2 className={`mt-4 max-w-3xl font-display text-4xl uppercase leading-[0.98] sm:text-6xl ${dark ? "text-paper" : "text-ink"}`}>
          {title}
        </h2>
        {children && (
          <p className={`mt-5 max-w-xl font-serif text-lg leading-relaxed ${dark ? "text-dfog" : "text-ink/75"}`}>
            {children}
          </p>
        )}
      </div>
    </Reveal>
  );
}
