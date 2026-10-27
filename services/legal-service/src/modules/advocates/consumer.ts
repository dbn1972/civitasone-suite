import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { invalidateItemAndLists } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import * as repo from "./repo.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerAdvocateConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.advocateCreate, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; name: string; barEnrolmentNo: string; contact: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertAdvocate(tx, {
        id: p.id, tenantId: p.tenantId, name: p.name, barEnrolmentNo: p.barEnrolmentNo, contact: p.contact,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      // The contact is PII: the audit event records the advocate, never the contact value.
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "legal", action: "create", resourceType: "advocate", resourceId: p.id, outcome: "success", newValue: { name: p.name, barEnrolmentNo: p.barEnrolmentNo } },
      });
    });
    await invalidateItemAndLists(msg.tenantId, null, ["advocates", "cases"]);
  });
}
