/**
 * Shared helpers for Phase-3 cross-service choreography seam tests.
 *
 * Each test verifies a producer→consumer seam at TWO levels:
 *   (A) EMIT side  — drive the REAL source command consumer on the shared
 *       ChainHarness bus and assert the expected domain event lands in the
 *       transactional OUTBOX (the harness re-publishes enqueued outbox rows onto
 *       the bus exactly as the real relay does post-commit, so we can capture
 *       them with a real subscriber + queue.drain() — no fixed sleeps).
 *   (B) CONSUME side — register the REAL target consumer on a RecordingQueue and
 *       assert it subscribes to the EXACT topic string the emitter uses.
 *
 * A match on both sides ⇒ WIRED. Emit present but no subscriber ⇒ ORPHANED.
 */
import type { Queue } from "../../packages/queue/dist/index.js";
import type { CommandEnvelope } from "../../packages/queue/dist/index.js";
import type { ChainHarness } from "../integration/harness.js";

export const TENANT = "11111111-aaaa-4000-8000-000000000abc";
export const ACTOR = "22222222-bbbb-4000-8000-000000000def";

export function envelope(messageId: string, type: string, payload: Record<string, unknown>) {
  return {
    messageId,
    type,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: `corr-${messageId.slice(0, 8)}`,
    schemaVersion: "1.0",
    payload,
  };
}

/**
 * Minimal Queue that only RECORDS which topics a consumer registration
 * subscribes to. Handlers are never invoked, so no service DB is needed — this
 * isolates the (B) consumer-registration assertion.
 */
export class RecordingQueue {
  readonly subscribedTopics = new Set<string>();
  async publish(): Promise<string> {
    return "noop";
  }
  subscribe(topic: string): void {
    this.subscribedTopics.add(topic);
  }
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async healthCheck(): Promise<{ healthy: boolean; driver: "memory" }> {
    return { healthy: true, driver: "memory" };
  }
  /** Cast to the Queue interface for passing into a real register*Consumers(queue). */
  asQueue(): Queue {
    return this as unknown as Queue;
  }
}

/**
 * Collect every envelope published to `topic` on the harness bus. Returns an
 * array that fills as deliveries settle; call `await harness.queue.drain()`
 * before asserting so all in-flight fan-out (including re-published outbox rows)
 * has completed deterministically.
 */
export function collect(harness: ChainHarness, topic: string): CommandEnvelope[] {
  const received: CommandEnvelope[] = [];
  harness.queue.subscribe(topic, async (msg) => {
    received.push(msg);
  });
  return received;
}
