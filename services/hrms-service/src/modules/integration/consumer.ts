import { randomUUID } from "node:crypto";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { CONSUMED_EVENTS } from "../../topics.js";
import { hrmsLeaveTypes } from "../leave/schema.js";

const AUDIT_TOPIC = "audit.event.record";

/** Seed default leave types when a tenant is provisioned. */
export function registerIntegrationConsumers(queue: Queue): void {
  queue.subscribe(CONSUMED_EVENTS.tenantCreated, async (msg) => {
    const p = msg.payload as { tenantId: string };
    if (!p.tenantId) return;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const actor = msg.actorId;
      const rows = [
        { code: "EL", name: "Earned Leave", maxDays: 30, carryForward: true },
        { code: "CL", name: "Casual Leave", maxDays: 15, carryForward: false },
        { code: "HPL", name: "Half Pay Leave", maxDays: 20, carryForward: false },
      ];
      for (const row of rows) {
        await tx.insert(hrmsLeaveTypes).values({
          id: randomUUID(),
          tenantId: p.tenantId,
          code: row.code,
          name: row.name,
          maxDays: row.maxDays,
          isEncashable: false,
          carryForward: row.carryForward,
          createdBy: actor,
          updatedBy: actor,
        });
      }
      await enqueue(tx as Parameters<typeof enqueue>[0], {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "hrms", action: "seed_leave_types", resourceType: "leave_type", resourceId: p.tenantId, outcome: "success" },
      });
    });
  });
}
