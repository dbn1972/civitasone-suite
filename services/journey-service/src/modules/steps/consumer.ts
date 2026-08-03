/**
 * steps/consumer.ts — the journey step execution path (P1-8).
 *
 * This is where a journey stops being a list of rows and starts doing something.
 * Each `journey.step.execute` command is dispatched according to its `stepType`:
 *
 *   send_notification  enqueues `notification.send` through the outbox, so
 *                      notification-service owns the send (and its consent gate)
 *   wait               parks the row at `waiting` with a resume_at deadline
 *   condition_check    evaluates the gate and either continues or exits the run
 *   api_call           performs the guarded outbound request
 *
 * Anything else, or a step whose config cannot be honoured, is recorded as
 * `failed` with a failure code and a `journey.step.failed` event. It is never
 * recorded as a success.
 *
 * Ordering matters here. Outbound I/O (api_call) happens BEFORE the transaction
 * opens, because calling out from inside a transaction pins a pooled connection
 * for the length of a remote timeout. The transaction then does the whole DB
 * effect at once — dedupe, terminal status, outbox, audit — so a redelivery
 * either applies everything or nothing.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { idempotentId } from "@civitasone/auth";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS, SERVICE } from "../../topics.js";
import * as repo from "./repo.js";
import {
  planStep,
  performApiCall,
  StepDispatchError,
  type StepPlan,
  type Fetcher,
} from "./dispatch.js";

const log = pino({ name: "journey.steps.consumer" });

const NOTIFICATION_SEND = "notification.send";

interface MsgMeta {
  tenantId: string;
  actorId: string;
  correlationId: string;
  messageId: string;
}

function ctxOf(msg: MsgMeta) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export interface StepExecutePayload {
  id: string;
  tenantId: string;
  journeyId: string;
  profileId: string;
  stepIndex: number;
  stepType: string;
  /** The step definition's config, copied from journeys.steps by the route. */
  stepConfig?: Record<string, unknown>;
  /** Attributes the trigger/enrollment captured, read by `condition_check`. */
  context?: Record<string, unknown>;
  /** Step count of the journey, so the run can be advanced without a cross-module read. */
  totalSteps?: number;
}

export interface StepWaitResumePayload {
  stepExecutionId: string;
  journeyId: string;
  profileId: string;
  stepIndex: number;
  totalSteps: number;
}

/**
 * Test seam for the api_call transport. Production always uses global fetch;
 * tests swap it so the dispatch and its failure classification can be asserted
 * without a real endpoint.
 */
let fetchImpl: Fetcher | undefined;
export function setApiCallFetchForTests(fn: Fetcher): void {
  fetchImpl = fn;
}
export function resetApiCallFetch(): void {
  fetchImpl = undefined;
}

export function registerStepConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.stepExecute, async (msg) => {
    const p = msg.payload as StepExecutePayload;
    const meta: MsgMeta = {
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      messageId: msg.messageId,
    };

    // 1. Decide what the step does. A step type we cannot honour becomes a
    //    terminal failure below, never a silent success.
    let plan: StepPlan | null = null;
    let failure: { code: string; reason: string } | null = null;
    try {
      plan = planStep({
        stepType: p.stepType,
        config: p.stepConfig ?? {},
        profileId: p.profileId,
        context: p.context ?? {},
        now: new Date(),
      });
    } catch (err) {
      failure = classify(err, meta, p);
    }

    // 2. Outbound I/O, outside any transaction. A retryable transport failure is
    //    rethrown so the queue retries and finally DLQs the command.
    if (plan?.kind === "api_call") {
      try {
        const outcome = await performApiCall(
          plan.request,
          { idempotencyKey: msg.messageId, correlationId: msg.correlationId, tenantId: msg.tenantId },
          fetchImpl ?? fetch,
        );
        log.info({ stepExecutionId: p.id, status: outcome.status }, "api_call step dispatched");
      } catch (err) {
        failure = classify(err, meta, p);
        plan = null;
      }
    }

    // 3. One transaction for the entire DB effect.
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const status = failure ? "failed" : plan!.status;
      await repo.insert(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        journeyId: p.journeyId,
        profileId: p.profileId,
        stepIndex: p.stepIndex,
        stepType: p.stepType,
        totalSteps: p.totalSteps ?? p.stepIndex + 1,
        status,
        ...(plan?.kind === "wait" ? { resumeAt: plan.resumeAt } : {}),
        ...(failure ? { failureCode: failure.code, failureReason: failure.reason } : {}),
        ...(plan?.kind === "condition" && !plan.passed
          ? { failureCode: "CONDITION_NOT_MET", failureReason: plan.reason }
          : {}),
        executedAt: new Date(),
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });

      const base = {
        stepExecutionId: p.id,
        journeyId: p.journeyId,
        profileId: p.profileId,
        stepIndex: p.stepIndex,
        stepType: p.stepType,
      };

      if (failure) {
        // A step that could not act ends the run: leaving it mid-journey would
        // strand the profile with nothing to resume it.
        await emit(tx, meta, EVENTS.stepFailed, { ...base, failureCode: failure.code, reason: failure.reason });
        await advance(tx, meta, p, "exit");
        await writeAudit(tx, ctxOf(meta), {
          action: "step.execute",
          resourceType: "journey_step_execution",
          resourceId: p.id,
          outcome: "failure",
          details: { stepType: p.stepType, status: "failed", failureCode: failure.code },
        });
        return;
      }

      switch (plan!.kind) {
        case "notify": {
          // Cross-service work leaves as a command on notification-service's own
          // topic, from inside this transaction — journey-service never touches
          // notification's tables or database.
          await enqueue(tx, {
            topic: NOTIFICATION_SEND,
            eventType: NOTIFICATION_SEND,
            tenantId: msg.tenantId,
            actorId: msg.actorId,
            correlationId: msg.correlationId,
            payload: { ...plan!.notification, journeyId: p.journeyId, journeyStepIndex: p.stepIndex },
          });
          await emit(tx, meta, EVENTS.stepCompleted, base);
          await advance(tx, meta, p, "advance");
          break;
        }
        case "wait": {
          await emit(tx, meta, EVENTS.stepWaiting, { ...base, resumeAt: plan!.resumeAt.toISOString() });
          break;
        }
        case "condition": {
          const c = plan as Extract<StepPlan, { kind: "condition" }>;
          await emit(tx, meta, c.passed ? EVENTS.stepCompleted : EVENTS.stepSkipped, {
            ...base,
            reason: c.reason,
          });
          await advance(tx, meta, p, c.runOutcome === "exit" ? "exit" : "advance");
          break;
        }
        case "api_call": {
          await emit(tx, meta, EVENTS.stepCompleted, base);
          await advance(tx, meta, p, "advance");
          break;
        }
      }

      await writeAudit(tx, ctxOf(meta), {
        action: "step.execute",
        resourceType: "journey_step_execution",
        resourceId: p.id,
        details: { stepType: p.stepType, status: plan!.status },
      });
    });

    log.info({ id: p.id, stepType: p.stepType, failureCode: failure?.code ?? null }, "step dispatched");
  });

  // A parked `wait` step whose deadline elapsed. The sweeper publishes this with
  // a deterministic messageId, so republishing across sweep cycles collapses to
  // a single resume via markProcessed.
  queue.subscribe(COMMANDS.stepWaitResume, async (msg) => {
    const p = msg.payload as StepWaitResumePayload;
    const meta: MsgMeta = {
      tenantId: msg.tenantId,
      actorId: msg.actorId,
      correlationId: msg.correlationId,
      messageId: msg.messageId,
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Compare-and-set on the parked status: if the row already left `waiting`
      // this resume is a duplicate and must not advance the run again.
      const resumed = await repo.transitionStatus(tx, p.stepExecutionId, msg.tenantId, "waiting", "completed", {
        resumeAt: null,
      });
      if (!resumed) {
        log.warn({ stepExecutionId: p.stepExecutionId }, "wait resume skipped: step is no longer waiting");
        return;
      }
      await emit(tx, meta, EVENTS.stepCompleted, {
        stepExecutionId: p.stepExecutionId,
        journeyId: p.journeyId,
        profileId: p.profileId,
        stepIndex: p.stepIndex,
        stepType: "wait",
      });
      await advance(tx, meta, p, "advance");
      await writeAudit(tx, ctxOf(meta), {
        action: "step.wait_resume",
        resourceType: "journey_step_execution",
        resourceId: p.stepExecutionId,
        details: { stepType: "wait", outcome: "completed" },
      });
    });
  });
}

/**
 * Turn a thrown dispatch error into a terminal failure, or rethrow it. A
 * retryable StepDispatchError and any unexpected error propagate so the queue
 * retries and eventually DLQs — the caller must not swallow them.
 */
function classify(err: unknown, meta: MsgMeta, p: StepExecutePayload): { code: string; reason: string } {
  if (err instanceof StepDispatchError && !err.retryable) {
    log.error(
      { correlationId: meta.correlationId, stepExecutionId: p.id, stepType: p.stepType, failureCode: err.code },
      "step dispatch failed terminally",
    );
    return { code: err.code, reason: err.message };
  }
  log.warn(
    { correlationId: meta.correlationId, stepExecutionId: p.id, stepType: p.stepType, err },
    "step dispatch failed; leaving to queue retry",
  );
  throw err;
}

type EnqueueTx = Parameters<typeof enqueue>[0];

function emit(
  tx: EnqueueTx,
  meta: MsgMeta,
  topic: string,
  payload: Record<string, unknown>,
): Promise<void> {
  return enqueue(tx, {
    topic,
    eventType: topic,
    tenantId: meta.tenantId,
    actorId: meta.actorId,
    correlationId: meta.correlationId,
    payload,
  });
}

/**
 * Hand the run's progress to the executions module. Cross-module state is never
 * updated in place from here: the command goes out through the outbox and the
 * executions consumer applies it to its own table.
 */
function advance(
  tx: EnqueueTx,
  meta: MsgMeta,
  p: { journeyId: string; profileId: string; stepIndex: number; totalSteps?: number },
  outcome: "advance" | "exit",
): Promise<void> {
  return enqueue(tx, {
    topic: COMMANDS.executionAdvance,
    eventType: COMMANDS.executionAdvance,
    tenantId: meta.tenantId,
    actorId: meta.actorId,
    correlationId: meta.correlationId,
    payload: {
      journeyId: p.journeyId,
      profileId: p.profileId,
      fromStepIndex: p.stepIndex,
      totalSteps: p.totalSteps ?? p.stepIndex + 1,
      outcome,
    },
  });
}

/** Re-exported so the sweeper can derive the same stable resume messageId. */
export function waitResumeMessageId(stepExecutionId: string, resumeAt: Date): string {
  return idempotentId({ idempotencyKey: `${SERVICE}:wait_resume:${stepExecutionId}:${resumeAt.toISOString()}` });
}
