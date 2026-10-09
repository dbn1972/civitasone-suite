/**
 * Deterministic queue quiescence for tests (replaces fixed post-publish sleeps).
 *
 * MemoryQueue.publish() is fire-and-forget; a test that publishes and then
 * sleeps a fixed 100-700 ms before asserting DB state races CI contention.
 * MemoryQueue.drain() resolves exactly when every in-flight handler (including
 * retry backoffs and follow-on publishes) has settled. This wrapper bounds it
 * with a timeout that FAILS the test when it expires, so a stuck handler is a
 * red test with a clear message and never a silent pass or a hang.
 *
 * Imported by relative path from tests, like ./vitest.shared.ts.
 */
export async function drainOrFail(
  queue: unknown,
  timeoutMs = 20_000,
  label = "queue.drain()",
): Promise<void> {
  const q = queue as { drain?: () => Promise<void> };
  if (!q || typeof q.drain !== "function") {
    throw new Error(`${label}: queue has no drain(); use a MemoryQueue (QUEUE_DRIVER=memory)`);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} did not quiesce within ${timeoutMs}ms (a handler is stuck)`)),
      timeoutMs,
    );
  });
  try {
    await Promise.race([q.drain(), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
