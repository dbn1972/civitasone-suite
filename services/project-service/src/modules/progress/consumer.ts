import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertDprDateUnique } from "./domain.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerProgressConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.physicalProgressRecord, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; projectId: string; componentId?: string;
      periodDate: string; physicalPct: number; notes?: string; reportedBy: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertPhysicalProgress(tx, {
        id: p.id, projectId: p.projectId, componentId: p.componentId ?? null,
        tenantId: p.tenantId, periodDate: p.periodDate,
        physicalPct: String(p.physicalPct),
        cumulativePct: String(p.physicalPct),
        reportedBy: p.reportedBy, notes: p.notes ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.physicalProgressRecorded, eventType: EVENTS.physicalProgressRecorded,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { recordId: p.id, projectId: p.projectId, physicalPct: p.physicalPct },
      });
      await audit(tx, msg, "record", "physical_progress", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "progress", p.projectId));
  });

  queue.subscribe(COMMANDS.financialProgressRecord, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; projectId: string; periodDate: string;
      expenditureMinor: number; notes?: string; reportedBy: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertFinancialProgress(tx, {
        id: p.id, projectId: p.projectId, tenantId: p.tenantId,
        periodDate: p.periodDate, expenditureMinor: BigInt(p.expenditureMinor),
        cumulativeMinor: BigInt(p.expenditureMinor),
        reportedBy: p.reportedBy, notes: p.notes ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "record", "financial_progress", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "progress", p.projectId));
  });

  queue.subscribe(COMMANDS.dprSubmit, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; projectId: string; dprNo: string;
      dprDate: string; content?: Record<string, unknown>; submittedBy: string;
    };

    // DPR immutability: no duplicate for same project + date
    const existing = await repo.findDprByProjectAndDate(p.projectId, p.dprDate);
    if (existing) {
      // DPR for this date already exists — do not overwrite; idempotent ack
      return;
    }

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertDpr(tx, {
        id: p.id, projectId: p.projectId, tenantId: p.tenantId,
        dprNo: p.dprNo, dprDate: p.dprDate,
        content: p.content ?? {}, submittedBy: p.submittedBy,
        submittedAt: new Date(),
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.dprSubmitted, eventType: EVENTS.dprSubmitted,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { dprId: p.id, projectId: p.projectId, dprDate: p.dprDate },
      });
      await audit(tx, msg, "submit", "dpr", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "progress", p.projectId));
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "project", action, resourceType, resourceId, outcome: "success" },
  });
}
