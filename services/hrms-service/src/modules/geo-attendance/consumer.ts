import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";

const log = pino({ name: "geo-attendance-consumer" });
const AUDIT = "audit.event.record";

export function registerGeoAttendanceConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.geoCheckIn, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      employeeId: string;
      latitude: number;
      longitude: number;
      accuracyMeters?: number;
      officeLocationId?: string;
      selfieFileKey?: string;
      deviceId?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "geo_check_in",
          resourceType: "geo_attendance",
          resourceId: p.id,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "geo_attendance", p.employeeId));
    log.info({ messageId: msg.messageId }, "geo check-in processed");
  });

  queue.subscribe(COMMANDS.geoCheckOut, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      employeeId: string;
      latitude: number;
      longitude: number;
      accuracyMeters?: number;
      officeLocationId?: string;
      selfieFileKey?: string;
      deviceId?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "hrms",
          action: "geo_check_out",
          resourceType: "geo_attendance",
          resourceId: p.id,
          outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "geo_attendance", p.employeeId));
    log.info({ messageId: msg.messageId }, "geo check-out processed");
  });

  log.info("geo-attendance consumers registered");
}
