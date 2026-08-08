/**
 * Test harness for driving metadata-service command consumers.
 *
 * Routes are queue-first (202 Accepted). Tests that assert persisted state must
 * register the same consumers the worker registers against the in-memory bus,
 * then await `drainQueue()` so deliveries settle deterministically.
 */
import type { MemoryQueue } from "@civitasone/queue";
import { queue } from "../src/shared/infra.js";
import { registerEntityConsumers } from "../src/modules/entities/consumer.js";
import { registerFieldConsumers } from "../src/modules/fields/consumer.js";
import { registerRuleConsumers } from "../src/modules/rules/consumer.js";
import { registerRecordConsumers } from "../src/modules/records/consumer.js";
import { registerFormConsumers } from "../src/modules/forms/consumer.js";
import { registerCompositionConsumers } from "../src/modules/composition/consumer.js";
import { registerLayoutConsumers } from "../src/modules/layouts/consumer.js";
import { registerNumberingConsumers } from "../src/modules/numbering/consumer.js";
import { registerFormulaConsumers } from "../src/modules/formula/consumer.js";

let registered = false;

/** Register worker command consumers once per vitest process. Idempotent. */
export function registerConsumersOnce(): void {
  if (registered) return;
  registerEntityConsumers(queue);
  registerFieldConsumers(queue);
  registerRuleConsumers(queue);
  registerRecordConsumers(queue);
  registerFormConsumers(queue);
  registerCompositionConsumers(queue);
  registerLayoutConsumers(queue);
  registerNumberingConsumers(queue);
  registerFormulaConsumers(queue);
  registered = true;
}

/** Resolve once every in-flight consumer delivery has settled. */
export async function drainQueue(): Promise<void> {
  const q = queue as MemoryQueue;
  if (typeof q.drain === "function") await q.drain();
  else await new Promise<void>((r) => setTimeout(r, 400));
}
