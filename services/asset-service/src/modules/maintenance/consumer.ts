import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerMaintenanceConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.maintenancePlan, async (msg) => {
    const p = msg.payload as {
      id: string; assetId: string; tenantId: string; frequency: string; nextDue?: string; description?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertMaintenancePlan(tx, {
        id: p.id, tenantId: p.tenantId, assetId: p.assetId,
        frequency: p.frequency, nextDue: p.nextDue ?? null, lastDone: null,
        description: p.description ?? null, status: "active",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "maintenance_plan", p.id);
    });
  });

  queue.subscribe(COMMANDS.workOrderCreate, async (msg) => {
    const p = msg.payload as {
      id: string; assetId: string; tenantId: string; planId?: string; scheduledDate: string; notes?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertWorkOrder(tx, {
        id: p.id, tenantId: p.tenantId, assetId: p.assetId,
        planId: p.planId ?? null, scheduledDate: p.scheduledDate,
        completedDate: null, status: "open", costMinor: 0n, currency: "INR",
        notes: p.notes ?? null, createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      await audit(tx, msg, "create", "work_order", p.id);
    });
  });

  queue.subscribe(COMMANDS.workOrderComplete, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; completedDate: string; costMinor: number; currency: string; notes?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.completeWorkOrder(tx, p.id, p.completedDate, BigInt(p.costMinor), msg.actorId);
      await audit(tx, msg, "complete", "work_order", p.id);
    });
  });
}

async function audit(tx: any, msg: any, action: string, resourceType: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "asset", action, resourceType, resourceId, outcome: "success" },
  });
}
