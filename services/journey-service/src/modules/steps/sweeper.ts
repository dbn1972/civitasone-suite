/**
 * steps/sweeper.ts — resumes parked `wait` steps (P1-8).
 *
 * A `wait` step's deadline lives in Postgres (`status='waiting' AND resume_at <=
 * now()`), not in an in-process timer, so a wait survives a worker restart: a
 * step parked before a crash is picked up by the next sweep after the worker
 * comes back.
 *
 * The sweeper performs NO writes. It only republishes a resume command with a
 * deterministic messageId, so re-publishing the same due row on every cycle
 * until the consumer commits collapses to exactly one resume via the consumer's
 * `markProcessed` dedupe.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import { waitResumeMessageId } from "./consumer.js";

const log = pino({ name: "journey:wait-sweeper" });

/** Republish resume commands for every due wait step. Returns the count published. */
export async function sweepDueWaits(queue: Queue, now = new Date()): Promise<number> {
  const due = await repo.findDueWaits(now);
  let published = 0;
  for (const row of due) {
    if (!row.resumeAt) continue;
    try {
      await queue.publish(COMMANDS.stepWaitResume, {
        messageId: waitResumeMessageId(row.id, row.resumeAt),
        type: COMMANDS.stepWaitResume,
        tenantId: row.tenantId,
        actorId: row.updatedBy,
        correlationId: row.id,
        schemaVersion: "1.0",
        payload: {
          stepExecutionId: row.id,
          journeyId: row.journeyId,
          profileId: row.profileId,
          stepIndex: row.stepIndex,
          totalSteps: row.totalSteps ?? row.stepIndex + 1,
        },
      });
      published++;
    } catch (err) {
      log.warn({ err, stepExecutionId: row.id }, "failed to publish wait resume; will retry next sweep");
    }
  }
  if (published > 0) log.info({ published }, "wait sweep cycle complete");
  return published;
}

/** Run sweepDueWaits on an interval. Never rethrows — a failing cycle is logged. */
export function startWaitSweeper(queue: Queue, intervalMs = 30_000): NodeJS.Timeout {
  return setInterval(() => {
    sweepDueWaits(queue).catch((err) => log.warn({ err }, "wait sweep cycle failed"));
  }, intervalMs);
}
