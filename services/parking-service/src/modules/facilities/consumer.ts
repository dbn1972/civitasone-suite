import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { writeAudit } from "../../shared/audit.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";

const log = pino({ name: "parking.facilities.consumer" });

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
      totalSpaces: number;
      operatingHours?: { open: string; close: string; days?: string[] };
      tariffPerHourMinor?: string;
      tariffPerDayMinor?: string;
      monthlyPassMinor?: string;
      annualPassMinor?: string;
      contactPerson?: string;
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
        totalSpaces: p.totalSpaces,
        availableSpaces: p.totalSpaces,
        operatingHours: p.operatingHours ?? null,
        tariffPerHourMinor: p.tariffPerHourMinor ? BigInt(p.tariffPerHourMinor) : null,
        tariffPerDayMinor: p.tariffPerDayMinor ? BigInt(p.tariffPerDayMinor) : null,
        monthlyPassMinor: p.monthlyPassMinor ? BigInt(p.monthlyPassMinor) : null,
        annualPassMinor: p.annualPassMinor ? BigInt(p.annualPassMinor) : null,
        currency: "INR",
        status: "active",
        contactPerson: p.contactPerson ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.facilityCreated,
        eventType: EVENTS.facilityCreated,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { facilityId: p.id, facilityName: p.facilityName },
      });
      await writeAudit(tx, ctxOf(msg), {
        action: "facility.create",
        resourceType: "parking_facility",
        resourceId: p.id,
      });
    });
    log.info({ id: p.id }, "parking facility created");
  });

  queue.subscribe(COMMANDS.updateFacility, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; [key: string]: unknown };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const data: Record<string, unknown> = {};
      for (const key of ["facilityName", "totalSpaces", "availableSpaces", "operatingHours", "status", "contactPerson"]) {
        if (p[key] !== undefined) data[key] = p[key];
      }
      for (const key of ["tariffPerHourMinor", "tariffPerDayMinor", "monthlyPassMinor", "annualPassMinor"]) {
        if (p[key] !== undefined) data[key] = BigInt(p[key] as string);
      }
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
        resourceType: "parking_facility",
        resourceId: p.id,
      });
    });
  });
}
