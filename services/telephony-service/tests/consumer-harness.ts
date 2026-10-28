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
import { runWithTenant } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import * as callsRepo from "../src/modules/calls/repo.js";

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

/**
 * Insert a bare call row for `tenantId` so routes that now 404 on an unknown call id (ivr-hits) have a
 * real call to act on. Idempotent per (tenant, id).
 */
export async function seedCall(tenantId: string, callId: string): Promise<void> {
  const actor = "00000000-0000-4000-8000-0000000000aa";
  await runWithTenant(tenantId, () =>
    db.transaction(async (tx) => {
      if (await callsRepo.findRow(callId, tenantId, tx as never)) return;
      await callsRepo.insert(tx as never, { id: callId, tenantId, createdBy: actor, updatedBy: actor } as never);
    }),
  );
}
