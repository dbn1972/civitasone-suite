import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "journey.executions.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
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
}
