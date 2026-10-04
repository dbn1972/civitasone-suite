"use client";

import { useCallback, useEffect, useRef } from "react";

/** Minimal router surface used here (next/navigation's useRouter satisfies it). */
type Refresher = { refresh: () => void };

/**
 * The finance workflow routes answer 202 (the command is queued); the decision lands a moment later. After a 202 the
 * page re-reads its server data now and again at 1s, 2.5s and 5s, so the user sees the new state without a manual
 * reload. If the command was refused by the consumer (a lost race), the re-read simply shows the unchanged state.
 * Timers are cleared on unmount.
 */
export const SETTLE_DELAYS_MS = [0, 1000, 2500, 5000] as const;

export function useSettledRefresh(router: Refresher): () => void {
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current = []; }, []);
  return useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = SETTLE_DELAYS_MS.map((ms) => setTimeout(() => router.refresh(), ms));
  }, [router]);
}
