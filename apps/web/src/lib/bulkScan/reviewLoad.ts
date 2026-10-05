/**
 * The review page loads the file, the queue and the awaiting-approval links separately. A failed queue / links load must be shown
 * as an error, never as an empty queue ("no next file") or "nothing awaiting approval". Kept as a pure helper so the page has no
 * length checks of its own.
 */
export interface ReviewLoadFailures { queueFailed: boolean; awaitingFailed: boolean }

export function reviewLoadFailures(queue: { source: string }, awaiting: { source: string }): ReviewLoadFailures {
  return { queueFailed: queue.source === "error", awaitingFailed: awaiting.source === "error" };
}
