import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, CONSUME_TOPICS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertCanStart } from "./domain.js";

const AUDIT_TOPIC = CONSUME_TOPICS.auditEventRecord;

export function registerPlanConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.planCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; planNo: string; title: string; area: string;
      periodFrom: string; periodTo: string; riskLevel?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertPlan(tx, {
        id: p.id, tenantId: p.tenantId, planNo: p.planNo, title: p.title, area: p.area,
        periodFrom: p.periodFrom, periodTo: p.periodTo, riskLevel: p.riskLevel ?? "medium",
        status: "draft", createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "plan", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "plan", p.id));
  });

  queue.subscribe(COMMANDS.planItemCreate, async (msg) => {
    const p = msg.payload as {
      id: string; planId: string; tenantId: string; deptRef: string; unitRef?: string;
      scheduledFrom: string; scheduledTo: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertPlanItem(tx, {
        id: p.id, tenantId: p.tenantId, planId: p.planId, deptRef: p.deptRef,
        unitRef: p.unitRef ?? null, scheduledFrom: p.scheduledFrom, scheduledTo: p.scheduledTo,
        status: "scheduled", createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "plan_item", p.id);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "plan", p.planId));
  });

  queue.subscribe(COMMANDS.planStart, async (msg) => {
    const p = msg.payload as { planId: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const plan = await repo.findPlanByIdTx(tx, p.planId);
      if (!plan) throw new Error(`plan ${p.planId} not found`);
      assertCanStart(plan.status ?? "draft");
      await repo.updatePlan(tx, p.planId, { status: "active", updatedBy: msg.actorId, version: (plan.version ?? 1) + 1 });
      await audit(tx, msg, "start", "plan", p.planId);
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "plan", p.planId));
  });
}

async function audit(tx: any, msg: { tenantId: string; actorId: string; correlationId: string }, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "audit", action, resourceType, resourceId, outcome: "success" },
  });
}
