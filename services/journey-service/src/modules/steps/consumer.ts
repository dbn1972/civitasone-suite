import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "journey.steps.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerStepConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.stepExecute, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      journeyId: string;
      profileId: string;
      stepIndex: number;
      stepType: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insert(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        journeyId: p.journeyId,
        profileId: p.profileId,
        stepIndex: p.stepIndex,
        status: "executing",
        executedAt: new Date(),
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.stepCompleted,
        eventType: EVENTS.stepCompleted,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { stepExecutionId: p.id, journeyId: p.journeyId, profileId: p.profileId, stepIndex: p.stepIndex },
      });
      await writeAudit(tx, ctxOf(msg), { action: "step.execute", resourceType: "journey_step_execution", resourceId: p.id });
    });
    log.info({ id: p.id }, "step executed");
  });
}
