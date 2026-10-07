"use client";
/**
 * GAP-AI-COPILOT-03 / GAP-AI-COPILOT-DETAIL-04: copilot answers are produced
 * asynchronously (the /ask endpoint returns 202 and a consumer fills in the
 * response later). The console used to show the new turn as "Awaiting" and the
 * detail page used to tell the user to "reload this page in a moment" — neither
 * refreshed itself. This mounts only while something is still awaiting and
 * polls `router.refresh()` on a fixed interval, stopping once nothing is
 * awaiting or after a hard cap, so it never polls ai-agent-service forever.
 *
 * It renders nothing; it is a pure side-effect component.
 */
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export interface AutoRefreshProps {
  /** Poll only while this is true (e.g. there is at least one awaiting turn). */
  active: boolean;
  /** Milliseconds between refreshes. Default 5s. */
  intervalMs?: number;
  /** Stop polling after this many milliseconds, whatever the state. Default 2min. */
  maxMs?: number;
}

export function AutoRefresh({ active, intervalMs = 5000, maxMs = 120000 }: AutoRefreshProps) {
  const router = useRouter();
  const startedAt = useRef<number>(Date.now());

  useEffect(() => {
    if (!active) return;
    startedAt.current = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - startedAt.current >= maxMs) {
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs, maxMs, router]);

  return null;
}
