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

  // GAP-HR-ATTENDANCE-REPORTEES-01 (DPDP): the actual audit-outbox insert
  // for a privileged bulk read of other employees' geo-attendance via
  // GET .../attendance/reportees — published (fire-and-forget) by
  // routes.ts's auditReporteesListRead, since a route may not write to
  // Postgres directly (CI's f3-leftover-hrms-cqrs.test.ts greps every
  // *routes.ts file for a synchronous db.transaction/Drizzle write) and
  // there is no business write on this GET to piggyback a transaction on.
  // Mirrors GAP-HR-MEDICAL-01's medicalClaimsListRead subscriber exactly:
  // msg.payload is already the exact shape the read route wants recorded,
  // so it passes straight through as the audit event's payload. Wrapped in
  // db.transaction() like every other subscriber in this file, regardless
  // of any doc comment elsewhere claiming the outbox's RLS was dropped —
  // this dev environment's _outbox.messages has RLS live-enabled.
  queue.subscribe(COMMANDS.geoAttendanceReporteesRead, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await enqueue(tx, {
        topic: AUDIT,
        eventType: AUDIT,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: msg.payload as Record<string, unknown>,
      });
    });
    log.info({ messageId: msg.messageId }, "geo-attendance reportees list-read audit recorded");
  });

  log.info("geo-attendance consumers registered");
}
