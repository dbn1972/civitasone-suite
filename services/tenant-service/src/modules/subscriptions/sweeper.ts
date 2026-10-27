/**
 * F8: applies approved plan downgrades once the billing period they were scheduled
 * for has ended. The sweeper only FINDS due requests (cross-tenant, through the
 * SECURITY DEFINER function of migration 0033) and publishes one apply command per
 * request; the consumer is the only writer and re-checks everything under the
 * tenant's own RLS, so a duplicate or racing sweep is harmless.
 */
import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

/** Publishes an apply command for every due downgrade; returns how many were found. */
export async function sweepDueDowngrades(queue: Pick<Queue, "publish">, limit = 100): Promise<number> {
  const due = await repo.listDueDowngradesForPlatform(limit);
  for (const d of due) {
    await queue.publish(COMMANDS.subscriptionDowngradeApply, {
      messageId: randomUUID(),
      type: COMMANDS.subscriptionDowngradeApply,
      tenantId: d.tenantId,
      // The approving billing officer stays the recorded actor of the scheduled change.
      actorId: d.decidedBy,
      correlationId: randomUUID(),
      schemaVersion: "1.0",
      payload: { id: d.id },
    });
  }
  return due.length;
}

/** Runs the sweep on an interval (the worker owns the timer). */
export function startDowngradeSweeper(queue: Pick<Queue, "publish">, onError: (err: unknown) => void, intervalMs = 15 * 60_000): ReturnType<typeof setInterval> {
  const tick = () => { sweepDueDowngrades(queue).catch(onError); };
  tick();
  return setInterval(tick, intervalMs);
}
