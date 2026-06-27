"use client";

import { useEffect } from "react";
import { trackActivation, type FunnelStep } from "@/lib/activation";

/**
 * Fires one or more activation funnel events on mount, de-duplicated per browser
 * session so a step isn't re-counted on every navigation. The server also keeps
 * only the earliest timestamp per office+step, so TTFRT stays accurate even if a
 * step is emitted more than once. Instrumentation never blocks the UI.
 */
export function ActivationTracker({ steps }: { steps: FunnelStep[] }) {
  useEffect(() => {
    for (const step of steps) {
      const key = `civitasone.activation.${step}`;
      try {
        if (sessionStorage.getItem(key)) continue;
        sessionStorage.setItem(key, "1");
      } catch {
        /* sessionStorage unavailable — still emit, server dedups by earliest */
      }
      trackActivation(step);
    }
    // steps is a stable small array from the server; intentionally run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
