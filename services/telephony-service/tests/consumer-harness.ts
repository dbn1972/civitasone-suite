/**
 * Test harness for driving telephony-service command consumers.
 *
 * The routes are queue-first (202 Accepted), so a test that asserts persisted
 * state has to register the consumers against the same in-memory bus the routes
 * publish to and then wait for the fan-out to settle. `drainQueue()` resolves
 * once every in-flight delivery has fully run, which is deterministic — unlike
 * racing a fixed sleep.
 */
import type { MemoryQueue } from "@civitasone/queue";
import { queue } from "../src/shared/infra.js";
import { registerCallConsumers } from "../src/modules/calls/consumer.js";
import { registerDidConsumers } from "../src/modules/did/consumer.js";
import { registerIvrConsumers } from "../src/modules/ivr/consumer.js";

let registered = false;

/**
 * Register the command consumers the worker registers, once per test process.
 * Idempotent so several suites in one file can call it freely.
 */
export function registerConsumersOnce(): void {
  if (registered) return;
  registerCallConsumers(queue);
  registerDidConsumers(queue);
  registerIvrConsumers(queue);
  registered = true;
}

/** Resolve once every in-flight consumer delivery has settled. */
export async function drainQueue(): Promise<void> {
  const q = queue as MemoryQueue;
  if (typeof q.drain === "function") await q.drain();
  else await new Promise<void>((r) => setTimeout(r, 400));
}
