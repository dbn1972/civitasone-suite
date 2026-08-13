import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "crematorium.facilities.consumer" });

function ctxOf(msg: { tenantId: string; actorId: string; correlationId: string }) {
  return { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId };
}

export function registerFacilityConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.createFacility, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      facilityName: string;
      facilityType: string;
      address: Record<string, unknown>;
      ward?: string;
      totalSlots: number;
      operatingHours?: { open: string; close: string; days?: string[] };
      contactPerson?: string;
      contactPhone?: string;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.insertFacility(tx, {
        id: p.id,
        tenantId: msg.tenantId,
        facilityName: p.facilityName,
        facilityType: p.facilityType,
        address: p.address as never,
        ward: p.ward ?? null,
        totalSlots: p.totalSlots,
        operatingHours: p.operatingHours ?? null,
        contactPerson: p.contactPerson ?? null,
        contactPhone: p.contactPhone ?? null,
        status: "active",
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.facilityCreated,
        eventType: EVENTS.facilityCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { facilityId: p.id, facilityName: p.facilityName, facilityType: p.facilityType },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "facility.create",
        resourceType: "crematorium_facility",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id, facilityName: p.facilityName }, "crematorium facility created");
  });

  queue.subscribe(COMMANDS.updateFacility, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      facilityName?: string;
      totalSlots?: number;
      operatingHours?: { open: string; close: string; days?: string[] };
      contactPerson?: string;
      contactPhone?: string;
      status?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const data: Record<string, unknown> = {};
      if (p.facilityName !== undefined) data.facilityName = p.facilityName;
      if (p.totalSlots !== undefined) data.totalSlots = p.totalSlots;
      if (p.operatingHours !== undefined) data.operatingHours = p.operatingHours;
      if (p.contactPerson !== undefined) data.contactPerson = p.contactPerson;
      if (p.contactPhone !== undefined) data.contactPhone = p.contactPhone;
      if (p.status !== undefined) data.status = p.status;
      const ok = await repo.updateFacility(tx, p.id, msg.tenantId, data as never, msg.actorId);
      if (!ok) return;
      await enqueue(tx, {
        topic: EVENTS.facilityUpdated,
        eventType: EVENTS.facilityUpdated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { facilityId: p.id },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "facility.update",
        resourceType: "crematorium_facility",
        resourceId: p.id,
      });
    });
  });
}
