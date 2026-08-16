/**
 * Test harness for driving crm-service command consumers.
 *
 * Two ways in, both used by the consumer tests:
 *  - `drainQueue()` after an HTTP 202, to assert what the real route → bus →
 *    consumer path actually wrote;
 *  - `captureHandlers()` to invoke a handler directly, for cases the bus hides
 *    (a redelivered messageId, or state that changed after the route accepted).
 *
 * Direct invocation must be wrapped in `runWithTenant`: on the real queue
 * `createQueue()` decorates subscribe so handlers run in a tenant context, and
 * without it the FORCE-RLS tables reject every write.
 */
import type { CommandEnvelope, MemoryQueue } from "@civitasone/queue";
import { randomUUID } from "node:crypto";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";

export type Handler = (msg: CommandEnvelope) => Promise<void>;

/** Resolve once every in-flight consumer delivery has settled. */
export async function drainQueue(): Promise<void> {
  const q = queue as MemoryQueue;
  if (typeof q.drain === "function") await q.drain();
  else await new Promise<void>((r) => setTimeout(r, 400));
}

/** Register every consumer against a stub bus and expose the handlers by topic.
 *
 * The stub stores ALL subscribers per topic in an array, mirroring real-queue
 * fan-out semantics. Using a plain Map that overwrites on each subscribe() call
 * silently dropped every handler except the last one registered for a topic —
 * e.g. registerCommissionConsumers() subscribes to EVENTS.dealClosed AFTER
 * registerOnboardingConsumers(), so the onboarding handler was never reachable
 * via captureHandlers().handlerFor(EVENTS.dealClosed).
 */
export function captureHandlers(): { handlerFor: (topic: string) => Handler } {
  const handlers = new Map<string, Handler[]>();
  const stub = {
    subscribe: (topic: string, handler: Handler) => {
      const list = handlers.get(topic) ?? [];
      list.push(handler);
      handlers.set(topic, list);
    },
    publish: async () => "stub-id",
    start: async () => {},
    stop: async () => {},
  };
  registerAllConsumers(stub as never);
  return {
    handlerFor(topic: string): Handler {
      const list = handlers.get(topic);
      if (!list || list.length === 0) throw new Error(`no consumer registered for topic "${topic}"`);
      // Composite: invoke every subscriber in registration order, exactly as the
      // real queue delivers a message to all subscribers for the same topic.
      return async (msg: CommandEnvelope) => {
        for (const h of list) {
          await h(msg);
        }
      };
    },
  };
}

export function envelope(
  type: string,
  payload: unknown,
  opts: { tenantId: string; actorId: string; messageId?: string },
): CommandEnvelope {
  return {
    messageId: opts.messageId ?? randomUUID(),
    type,
    tenantId: opts.tenantId,
    actorId: opts.actorId,
    correlationId: randomUUID(),
    schemaVersion: "1.0",
    payload,
  } as CommandEnvelope;
}
