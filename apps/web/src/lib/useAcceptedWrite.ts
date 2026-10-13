"use client";

/**
 * useAcceptedWrite - page-facing wrapper over `useAsyncMutation` for the shared 202 convention (SF-15; see the
 * `AcceptedNotice` ds component for the state list).
 *
 *   const accepted = useAcceptedWrite();
 *   ...
 *   accepted.accept();                       // you already got the 202 yourself   -> "accepted" (no fake success)
 *   await accepted.run(async () => {...});   // or let the hook run the POST       -> submitting -> accepted
 *   <AcceptedNotice {...accepted.noticeProps} />
 *
 * Pass `poll` + `isDone` ONLY when a real read endpoint exists for the resource: the hook then polls it (bounded,
 * backed off) and, once `isDone` says the change is visible, refreshes the page data and moves to "confirmed". With
 * no poll, the state stays "accepted" and the user refreshes manually. There is intentionally no timer-based refresh.
 */
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAsyncMutation, type AsyncMutationPhase } from "./useAsyncMutation";

export interface UseAcceptedWriteOptions<TMutate, TPoll> {
  poll?: (mutateResult: TMutate, attempt: number) => Promise<TPoll>;
  isDone?: (pollResult: TPoll, mutateResult: TMutate) => boolean;
  onConfirmed?: (pollResult: TPoll, mutateResult: TMutate) => void;
  maxAttempts?: number;
  initialDelayMs?: number;
}

export function useAcceptedWrite<TMutate = void, TPoll = unknown>(options: UseAcceptedWriteOptions<TMutate, TPoll> = {}) {
  const router = useRouter();
  const [refreshes, setRefreshes] = useState(0);
  const mutateRef = useRef<() => Promise<TMutate>>(async () => undefined as TMutate);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const m = useAsyncMutation<TMutate, TPoll>({
    mutate: () => mutateRef.current(),
    ...(options.poll && options.isDone ? { poll: (r: TMutate, a: number) => optionsRef.current.poll!(r, a), isDone: (p: TPoll, r: TMutate) => optionsRef.current.isDone!(p, r) } : {}),
    onConfirmed: (p, r) => {
      router.refresh();
      optionsRef.current.onConfirmed?.(p, r);
    },
    ...(options.maxAttempts !== undefined ? { maxAttempts: options.maxAttempts } : {}),
    ...(options.initialDelayMs !== undefined ? { initialDelayMs: options.initialDelayMs } : {}),
  });

  const { accept: acceptInner, run: runInner, reset: resetInner } = m;
  const accept = useCallback((mutateResult?: TMutate) => { setRefreshes(0); return acceptInner(mutateResult); }, [acceptInner]);
  const run = useCallback((fn: () => Promise<TMutate>) => { setRefreshes(0); mutateRef.current = fn; return runInner(); }, [runInner]);
  const refresh = useCallback(() => { router.refresh(); setRefreshes((n) => n + 1); }, [router]);
  const reset = useCallback(() => { setRefreshes(0); resetInner(); }, [resetInner]);

  const phase: AsyncMutationPhase = m.phase;
  return {
    phase,
    isBusy: m.isBusy,
    error: m.error,
    accept,
    run,
    refresh,
    reset,
    /** Spread into `<AcceptedNotice {...accepted.noticeProps} />`. */
    noticeProps: {
      phase,
      error: m.error,
      refreshed: refreshes > 0,
      onRefresh: refresh,
      onDismiss: reset,
    },
  };
}
