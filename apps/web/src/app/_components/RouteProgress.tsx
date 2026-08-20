"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Thin top-of-page progress bar that animates on route changes.
 * No external dependency — pure CSS transitions driven by pathname changes.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const barRef = useRef<HTMLDivElement>(null);
  const prevPath = useRef<string | null>(null);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;

    if (prevPath.current !== null && prevPath.current !== pathname) {
      // Reset without transition, then animate 0 → 80% → 100%, then fade out.
      bar.style.transition = "none";
      bar.style.opacity = "1";
      bar.style.width = "0%";
      void bar.offsetWidth; // force reflow

      bar.style.transition = "width 320ms ease";
      bar.style.width = "80%";

      const t1 = setTimeout(() => {
        bar.style.transition = "width 200ms ease";
        bar.style.width = "100%";
      }, 320);

      const t2 = setTimeout(() => {
        bar.style.transition = "opacity 280ms ease";
        bar.style.opacity = "0";
        const t3 = setTimeout(() => { bar.style.width = "0%"; }, 280);
        return () => clearTimeout(t3);
      }, 520);

      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }

    prevPath.current = pathname;
  }, [pathname]);

  return (
    <div
      aria-hidden="true"
      style={{ position: "fixed", top: 0, left: 0, width: "100%", zIndex: 9999, pointerEvents: "none" }}
    >
      <div
        ref={barRef}
        style={{
          height: 3,
          width: "0%",
          opacity: 0,
          background: "var(--primary, #00439C)",
          borderRadius: "0 2px 2px 0",
          boxShadow: "0 0 10px var(--primary, #00439C)",
        }}
      />
    </div>
  );
}
