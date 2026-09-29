"use client";

/**
 * useAsyncMutation — "pending until confirmed" pattern for this app's async
 * write flow (CLAUDE.md: a route validates, queues a command, and returns
 * `202 Accepted` with the new id; the actual write lands later, in a queue
 * consumer). Several HR pages previously did a fixed `setTimeout` and then
 * navigated away or reloaded, optimistically assuming the queued write had
 * already landed by the time it fired (HR gap catalog, SF-15). That guess
 * is sometimes wrong — the read model updates whenever the consumer gets to
 * it, not on a fixed clock.
 *
 * This hook replaces the guess with real confirmation:
 *   1. `mutate()` performs the write (the POST). While it's in flight the
 *      caller is in the "submitting" phase.
 *   2. Once accepted, the phase becomes "pending" — an explicit in-flight
 *      state, never the stale old data and never a premature "success".
 *   3. `poll()` re-reads the resource's own existing GET endpoint on a
 *      capped, backed-off schedule; `isDone()` inspects each response and
 *      says whether the expected change is actually visible yet.
 *   4. Once `isDone()` returns true, the phase becomes "confirmed" and
 *      `onConfirmed` fires with the real data.
 *   5. If the change never shows up within the attempt cap, the phase
 *      becomes "timed_out" instead of polling forever — callers render a
 *      "still processing, refresh to check" message for that phase.
 *
 * There is no platform-wide "command status" API to ask instead, and
 * building one is out of scope here — this works with what already exists
 * (the resource's own GET). Shared, reusable infra: not a one-off for a
 * single page. Distinct from `lib/sync/*` (that subsystem is the
 * offline-first IndexedDB/service-worker cache for GET reads; this hook is
 * about confirming a single mutation's write actually landed).
 */
import { useCallback, useEffect, useRef, useState } from "react";

export type AsyncMutationPhase =
  | "idle"
  | "submitting"
  | "pending"
  | "confirmed"
  | "timed_out"
  | "error";

export type UseAsyncMutationOptions<TMutateResult, TPollResult> = {
  /**
   * Perform the write itself (the POST/PATCH/etc.). Must resolve only on
   * success and reject with a caller-supplied, already display-safe message
   * on failure — components keep using their own error formatting (e.g.
   * `useFormError`) inside this callback and throw once it's resolved.
   */
  mutate: () => Promise<TMutateResult>;
  /**
   * Read the resource's existing GET endpoint. Called repeatedly (capped,
   * with backoff) until `isDone` says the expected change has landed, or
   * attempts run out. A rejection here just counts as "not visible yet" for
   * this attempt — it does not abort the whole flow.
   */
  poll: (mutateResult: TMutateResult, attempt: number) => Promise<TPollResult>;
  /**
   * Inspect one poll response and say whether the expected change is now
   * visible in the read model.
   */
  isDone: (pollResult: TPollResult, mutateResult: TMutateResult) => boolean;
  /** Fires once, the first time `isDone()` returns true. */
  onConfirmed?: (pollResult: TPollResult, mutateResult: TMutateResult) => void;
  /** Fires once, if attempts run out before `isDone()` ever returns true. */
  onTimeout?: (mutateResult: TMutateResult) => void;
  /** Max number of polls before giving up. Default 5. */
  maxAttempts?: number;
  /** Delay before the first poll, in ms; also the backoff base. Default 500. */
  initialDelayMs?: number;
  /** Multiplier applied to the delay after each attempt. Default 1.6. */
  backoffFactor?: number;
};

export type UseAsyncMutationResult<TMutateResult, TPollResult> = {
  phase: AsyncMutationPhase;
  /**
   * Convenience for disabling a submit control: true while it should stay
   * disabled/aria-busy (covers both "submitting" the write and "pending"
   * confirmation, since the whole cycle is one logical in-flight action).
   */
  isBusy: boolean;
  /** How many poll attempts have completed so far (0 before the first). */
  attempt: number;
  error: string | null;
  mutateResult: TMutateResult | null;
  pollResult: TPollResult | null;
  /** Runs the mutation, then polls for confirmation. No-op while already busy. */
  run: () => Promise<void>;
  /** Back to "idle", clearing attempt/error/results (e.g. to let the user retry). */
  reset: () => void;
};

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_BACKOFF_FACTOR = 1.6;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useAsyncMutation<TMutateResult, TPollResult>(
  options: UseAsyncMutationOptions<TMutateResult, TPollResult>,
): UseAsyncMutationResult<TMutateResult, TPollResult> {
  const [phase, setPhase] = useState<AsyncMutationPhase>("idle");
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [mutateResult, setMutateResult] = useState<TMutateResult | null>(null);
  const [pollResult, setPollResult] = useState<TPollResult | null>(null);

  // `run()`'s poll loop spans many renders (every state update re-renders
  // the owning component, which creates a brand new `options` object with
  // fresh closures) — always read the latest via a ref rather than closing
  // over the object captured when the loop began.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Bumped on unmount/reset to invalidate any in-flight loop so it stops
  // touching state after the fact (a stale loop just returns quietly).
  const generationRef = useRef(0);
  const runningRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, []);

  const reset = useCallback(() => {
    generationRef.current += 1;
    runningRef.current = false;
    setPhase("idle");
    setAttempt(0);
    setError(null);
    setMutateResult(null);
    setPollResult(null);
  }, []);

  const run = useCallback(async () => {
    if (runningRef.current) return; // ignore overlapping submits
    runningRef.current = true;
    const generation = ++generationRef.current;
    const isCurrent = () => mountedRef.current && generationRef.current === generation;

    setError(null);
    setPollResult(null);
    setAttempt(0);
    setPhase("submitting");

    let mutated: TMutateResult;
    try {
      mutated = await optionsRef.current.mutate();
    } catch (err) {
      if (isCurrent()) {
        setError(err instanceof Error ? err.message : String(err));
        setPhase("error");
      }
      runningRef.current = false;
      return;
    }

    if (!isCurrent()) return;
    setMutateResult(mutated);
    setPhase("pending");

    const maxAttempts = optionsRef.current.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const initialDelayMs = optionsRef.current.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
    const backoffFactor = optionsRef.current.backoffFactor ?? DEFAULT_BACKOFF_FACTOR;

    for (let i = 0; i < maxAttempts; i++) {
      const waitMs = initialDelayMs * Math.pow(backoffFactor, i);
      await delay(waitMs);
      if (!isCurrent()) return;

      setAttempt(i + 1);

      let polled: TPollResult | undefined;
      let done = false;
      try {
        polled = await optionsRef.current.poll(mutated, i + 1);
        done = optionsRef.current.isDone(polled, mutated);
      } catch {
        done = false; // transient poll failure: just consumes this attempt
      }

      if (!isCurrent()) return;

      if (done && polled !== undefined) {
        setPollResult(polled);
        setPhase("confirmed");
        optionsRef.current.onConfirmed?.(polled, mutated);
        runningRef.current = false;
        return;
      }
    }

    if (!isCurrent()) return;
    setPhase("timed_out");
    optionsRef.current.onTimeout?.(mutated);
    runningRef.current = false;
  }, []);

  return {
    phase,
    isBusy: phase === "submitting" || phase === "pending",
    attempt,
    error,
    mutateResult,
    pollResult,
    run,
    reset,
  };
}
