import { randomUUID } from "node:crypto";
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as journeyRepo from "../journeys/repo.js";
import { resolveStep } from "../journeys/domain.js";
import { computeNextStatus, validateExecutionTransition, type ExecutionStatus } from "./domain.js";

const log = pino({ name: "journey.executions.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export interface AdvancePayload {
  journeyId: string;
  profileId: string;
  /** Index of the step that just reached a terminal outcome. */
  fromStepIndex: number;
  totalSteps: number;
  /** `advance` moves to the next step (or completes); `exit` ends the run early. */
  outcome: "advance" | "exit";
}

export function registerExecutionConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.executionEnroll, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; journeyId: string; profileId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        journeyId: p.journeyId,
        profileId: p.profileId,
        status: "enrolled",
        currentStepIndex: 0,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.executionEnrolled,
        eventType: EVENTS.executionEnrolled,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { executionId: p.id, journeyId: p.journeyId, profileId: p.profileId },
      });
      await writeAudit(tx, ctxOf(msg), { action: "execution.enroll", resourceType: "journey_execution", resourceId: p.id });
    });
    log.info({ id: p.id }, "profile enrolled");
  });

  /**
   * Move a run forward after a step finished (P1-8). The steps module never
   * writes journey_executions itself — it enqueues this command, and the module
   * that owns the table applies it.
   */
  queue.subscribe(COMMANDS.executionAdvance, async (msg) => {
    const p = msg.payload as AdvancePayload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const run = await repo.findActiveForProfile(tx, msg.tenantId, p.journeyId, p.profileId);
      if (!run) {
        // The run already reached a terminal state (or was never enrolled). This
        // is a no-op, not a success: nothing is marked done that was not done.
        log.warn(
          { journeyId: p.journeyId, profileId: p.profileId, correlationId: msg.correlationId },
          "advance skipped: no in-flight run for profile",
        );
        return;
      }

      const from = run.status as ExecutionStatus;

      if (p.outcome === "exit") {
        const invalid = validateExecutionTransition(from, "exited");
        if (invalid) {
          log.warn({ executionId: run.id, from, invalid }, "advance rejected: invalid transition to exited");
          return;
        }
        await repo.updateStatus(tx, run.id, msg.tenantId, "exited", run.currentStepIndex, run.version);
        await emit(tx, msg, EVENTS.executionExited, {
          executionId: run.id,
          journeyId: p.journeyId,
          profileId: p.profileId,
          atStepIndex: run.currentStepIndex,
        });
        await writeAudit(tx, ctxOf(msg), {
          action: "execution.exit",
          resourceType: "journey_execution",
          resourceId: run.id,
          details: { fromStepIndex: p.fromStepIndex },
        });
        log.info({ executionId: run.id }, "run exited");
        return;
      }

      const target = computeNextStatus(p.fromStepIndex, p.totalSteps);
      const nextIndex = target === "completed" ? run.currentStepIndex : p.fromStepIndex + 1;

      // The state machine forbids enrolled → completed, so a single-step journey
      // has to pass through in_progress. Both hops run in this transaction, and
      // the second uses the version the first produced.
      let version = run.version;
      let current = from;
      if (target === "completed" && current === "enrolled") {
        const hopped = await repo.updateStatus(tx, run.id, msg.tenantId, "in_progress", p.fromStepIndex, version);
        if (!hopped) {
          log.warn({ executionId: run.id, version }, "advance lost a concurrent update; leaving run untouched");
          return;
        }
        current = "in_progress";
        version += 1;
      }

      const invalid = validateExecutionTransition(current, target);
      if (invalid) {
        log.warn({ executionId: run.id, from: current, target, invalid }, "advance rejected: invalid transition");
        return;
      }

      const applied = await repo.updateStatus(tx, run.id, msg.tenantId, target, nextIndex, version);
      if (!applied) {
        log.warn({ executionId: run.id, version }, "advance lost a concurrent update; leaving run untouched");
        return;
      }

      if (target === "completed") {
        await emit(tx, msg, EVENTS.journeyCompleted, {
          executionId: run.id,
          journeyId: p.journeyId,
          profileId: p.profileId,
          totalSteps: p.totalSteps,
        });
      } else {
        // P1-8 follow-up: bumping currentStepIndex is bookkeeping, not progress —
        // the run only actually moves if the new current step gets dispatched.
        // Before this, nothing anywhere ever published journey.step.execute for
        // any index past the one a caller (or the wait sweeper) explicitly
        // triggered, so every run silently froze "in_progress" forever after its
        // first non-terminal step.
        //
        // The journey lookup runs inside this same transaction: journeys are
        // only ever soft-deleted (status becomes 'archived', the row and its
        // steps stay readable), so findById returning null or the target index
        // resolving to nothing means genuine data corruption, not a normal
        // archive/delete. Throwing rolls back the currentStepIndex bump together
        // with the inbox claim, so the queue retries and this eventually DLQs —
        // visibly — instead of silently committing a run that says "in_progress
        // at step N" while nothing will ever dispatch step N.
        //
        // Known limitation: journey_executions has no persisted context column,
        // so an auto-chained step dispatches with an empty context, unlike the
        // first step (whose context a caller supplies explicitly on the manual
        // execute-step call). A condition_check step beyond position 0 cannot
        // see enrollment-time attributes yet — tracked separately, not fixed here.
        const journey = await journeyRepo.findById(p.journeyId, msg.tenantId);
        const next = journey ? resolveStep(journey.steps, nextIndex) : null;
        if (!next) {
          throw new Error(
            `cannot dispatch step ${nextIndex} of journey ${p.journeyId} for execution ${run.id}: ` +
              (journey ? "step definition missing or malformed" : "journey not found"),
          );
        }
        await enqueue(tx, {
          topic: COMMANDS.stepExecute,
          eventType: COMMANDS.stepExecute,
          tenantId: msg.tenantId,
          actorId: msg.actorId,
          correlationId: msg.correlationId,
          payload: {
            id: randomUUID(),
            tenantId: msg.tenantId,
            journeyId: p.journeyId,
            profileId: p.profileId,
            stepIndex: nextIndex,
            stepType: next.stepType,
            stepConfig: next.stepConfig,
            totalSteps: p.totalSteps,
          },
        });
      }

      await writeAudit(tx, ctxOf(msg), {
        action: target === "completed" ? "execution.complete" : "execution.advance",
        resourceType: "journey_execution",
        resourceId: run.id,
        details: { fromStepIndex: p.fromStepIndex, currentStepIndex: nextIndex, status: target },
      });
      log.info({ executionId: run.id, status: target, currentStepIndex: nextIndex }, "run advanced");
    });
  });
}

type EnqueueTx = Parameters<typeof enqueue>[0];

function emit(
  tx: EnqueueTx,
  msg: { tenantId: string; actorId: string; correlationId: string },
  topic: string,
  payload: Record<string, unknown>,
): Promise<void> {
  return enqueue(tx, {
    topic,
    eventType: topic,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload,
  });
}
