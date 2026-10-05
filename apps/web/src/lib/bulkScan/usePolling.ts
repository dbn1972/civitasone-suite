"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { pollDelayMs } from "./status";

export interface PollOutcome {
  /** keep polling (false = the work is settled, stop) */
  keepGoing: boolean;
  /** the data changed since the last poll (resets the backoff) */
  changed: boolean;
  /** the poll itself failed (backs off, and the caller shows a stale-data notice) */
  failed: boolean;
}

/**
 * Self-scheduling poll with exponential backoff: the delay grows while nothing changes or calls fail, and resets as soon
 * as something changes. Pauses while the tab is hidden and refreshes once when it becomes visible again.
 */
export function usePolling(tick: () => Promise<PollOutcome>, opts: { enabled: boolean; baseMs?: number; maxMs?: number }) {
  const { enabled, baseMs = 3000, maxMs = 30000 } = opts;
  const tickRef = useRef(tick);
  tickRef.current = tick;
  const attempt = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopped = useRef(false);
  const [failedLast, setFailedLast] = useState(false);
  const [lastRunAt, setLastRunAt] = useState<number | null>(null);

  const clear = useCallback(() => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } }, []);

  const run = useCallback(async (): Promise<void> => {
    clear();
    if (stopped.current) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      timer.current = setTimeout(() => { void run(); }, maxMs);
      return;
    }
    const out = await tickRef.current();
    if (stopped.current) return;
    setFailedLast(out.failed);
    setLastRunAt(Date.now());
    attempt.current = out.changed && !out.failed ? 0 : attempt.current + 1;
    if (out.keepGoing) timer.current = setTimeout(() => { void run(); }, pollDelayMs(attempt.current, { baseMs, maxMs }));
  }, [clear, baseMs, maxMs]);

  useEffect(() => {
    stopped.current = false;
    if (!enabled) { clear(); return; }
    attempt.current = 0;
    timer.current = setTimeout(() => { void run(); }, pollDelayMs(0, { baseMs, maxMs }));
    const onVisible = (): void => { if (document.visibilityState === "visible") { attempt.current = 0; void run(); } };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stopped.current = true; clear(); document.removeEventListener("visibilitychange", onVisible); };
  }, [enabled, run, clear, baseMs, maxMs]);

  /** Poll right now (after an action) and restart the schedule. */
  const refreshNow = useCallback(() => { attempt.current = 0; return run(); }, [run]);

  return { failedLast, lastRunAt, refreshNow };
}
