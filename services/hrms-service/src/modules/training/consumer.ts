import { hrmsServiceBookEntries } from "../service-book/schema.js";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT = "audit.event.record";

export function registerTrainingConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.trainingCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; title: string; fromDate: string; toDate: string; venue?: string; facilitator?: string; maxParticipants: number };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertTraining(tx, {
        id: p.id, tenantId: p.tenantId, title: p.title, fromDate: p.fromDate, toDate: p.toDate,
        venue: p.venue ?? null, facilitator: p.facilitator ?? null,
        maxParticipants: p.maxParticipants, status: "planned",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "training", p.id);
    });
  });

  queue.subscribe(COMMANDS.nominationCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; trainingId: string; employeeId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertNomination(tx, {
        id: p.id, tenantId: p.tenantId, trainingId: p.trainingId, employeeId: p.employeeId,
        status: "nominated", certificateRef: null, nominatedBy: msg.actorId,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "nominate", "nomination", p.id);
    });
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "hrms", action, resourceType, resourceId, outcome: "success" },
  });

  q.subscribe(COMMANDS.nominationComplete, async (msg) => {
    const p = msg.payload as any;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.completeNomination(tx, p.tenantId, p.id, msg.actorId, {
        completedDate: p.completedDate, result: p.result,
        score: p.score ?? null, certificateRef: p.certificateRef ?? null,
      });
      if (!row) return;
      await tx.insert(hrmsServiceBookEntries).values({
        tenantId: p.tenantId, employeeId: row.employeeId, entryType: "training",
        effectiveDate: p.completedDate,
        description: `Completed training "${p.trainingTitle ?? row.trainingId}" — result ${p.result}`,
        recordedBy: msg.actorId, documentRef: p.certificateRef ?? null,
      });
    });
  });
}
