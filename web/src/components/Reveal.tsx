import { useEffect, useRef, type ReactNode } from "react";

/** Scroll-reveal wrapper: fades+lifts children in when they enter viewport. */
export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: 0 | 1 | 2 | 3;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const delayCls = delay ? ` reveal-delay-${delay}` : "";
  return (
    <div ref={ref} className={`reveal${delayCls} ${className}`}>
      {children}
    </div>
  );
}
