import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "works-contractor-consumer" });
const AUDIT_TOPIC = "audit.event.record";

export function registerContractorConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  // works.contractor.create → works.contractors
  queue.subscribe(COMMANDS.contractorCreate, async (msg) => {
    try {
      const p = msg.payload as {
        id: string; tenantId: string; name: string;
        registrationNo?: string; classId?: string;
        pan?: string; gst?: string; email?: string; phone?: string; address?: string;
      };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.insertContractor(tx, {
          id: p.id, tenantId: p.tenantId, name: p.name,
          registrationNo: p.registrationNo ?? null,
          classId: p.classId ?? null,
          pan: p.pan ?? null, gst: p.gst ?? null,
          email: p.email ?? null, phone: p.phone ?? null,
          address: p.address ?? null,
          active: true,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        });
        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "works", action: "create", resourceType: "contractor", resourceId: p.id, outcome: "success" },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "contractorCreate processing failed");
    }
  });

  // works.contractor.rate → incremental average update
  queue.subscribe(COMMANDS.contractorRate, async (msg) => {
    try {
      const p = msg.payload as { id: string; tenantId: string; rating: number };
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.updateContractorRating(tx, p.id, p.tenantId, p.rating);
        await enqueue(tx, {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
          tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "works", action: "rate", resourceType: "contractor", resourceId: p.id, outcome: "success" },
        });
      });
    } catch (err) {
      log.error({ err, messageId: msg.messageId }, "contractorRate processing failed");
    }
  });
}
