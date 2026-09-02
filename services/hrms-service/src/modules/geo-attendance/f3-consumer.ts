import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { hrmsGeoAttendance, hrmsOfficeLocations } from "./schema.js";
import { hrmsHolidays } from "../holidays/schema.js";
const log = pino({ name: "hrms-f3-geo-attendance" });

/**
 * Haversine distance in meters. Mirrors the identically-named helper in
 * ./routes.ts — the route computes the distance to shape its HTTP response and
 * this consumer recomputes it to persist the row, so the two MUST stay in sync.
 * Keep both copies identical if either is ever changed.
 */
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type OfficeLoc = { id: string; latitude: number; longitude: number; radiusMeters: number } | null;

/**
 * Resolve the office location a geo punch is measured against, mirroring
 * routes.ts: an explicitly supplied officeLocationId wins, otherwise the
 * tenant's first active office is used. Returns null when the tenant has no
 * office configured (the route then stores the punch with no geofence result).
 */
async function resolveOfficeLoc(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  tenantId: string,
  officeLocationId: unknown,
): Promise<OfficeLoc> {
  const cols = {
    id: hrmsOfficeLocations.id,
    latitude: hrmsOfficeLocations.latitude,
    longitude: hrmsOfficeLocations.longitude,
    radiusMeters: hrmsOfficeLocations.radiusMeters,
  };
  if (typeof officeLocationId === "string" && officeLocationId) {
    const rows = await tx.select(cols).from(hrmsOfficeLocations)
      .where(and(eq(hrmsOfficeLocations.id, officeLocationId), eq(hrmsOfficeLocations.tenantId, tenantId)))
      .limit(1);
    return rows[0] ?? null;
  }
  const rows = await tx.select(cols).from(hrmsOfficeLocations)
    .where(and(eq(hrmsOfficeLocations.tenantId, tenantId), eq(hrmsOfficeLocations.isActive, true)))
    .limit(1);
  return rows[0] ?? null;
}

export function registerF3_geo_attendance_Consumers(queue: Queue): void {
  queue.subscribe(COMMANDS.f3RouteWrite, async (msg) => {
    const p = msg.payload as Record<string, any>;
    const op = String(p.op ?? "");
    const ops = new Set([
      "geo_attendance_routes__0",
      "geo_attendance_routes__1",
      "geo_attendance_routes__2",
    ]);
    if (!ops.has(op)) return;
    const body = p.body ?? {};
    const params = p.params ?? {};
    const id = (p.id as string) || (params.id as string);
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        switch (op) {
          case "geo_attendance_routes__0": {
            await tx.insert(hrmsOfficeLocations).values({ id, tenantId: p.tenantId, name: body.name, address: body.address ?? null, latitude: body.latitude, longitude: body.longitude, radiusMeters: body.radiusMeters, createdBy: msg.actorId });
            break;
          }
          case "geo_attendance_routes__1": {
            // F3 reconstruction: the code-gen that stubbed the geo-check-in route
            // down to publishF3Write(...) dropped the setup block that computed
            // `today`, `officeLoc`, `withinGeofence` and `distance` (see
            // routes.ts, POST /v1/hrms/attendance/geo-check-in steps 2-3). Those
            // names survived in the values() call below but were never declared
            // here, so this case threw a ReferenceError on EVERY check-in while
            // the route had already answered 201 — every geo check-in was a fake
            // success with no attendance row written. Reconstructed below.
            const today = new Date().toISOString().slice(0, 10);
            const officeLoc = await resolveOfficeLoc(tx, p.tenantId, body.officeLocationId);
            let withinGeofence = false;
            let distance: number | null = null;
            if (officeLoc) {
              distance = haversineMeters(Number(body.latitude), Number(body.longitude), officeLoc.latitude, officeLoc.longitude);
              withinGeofence = distance <= officeLoc.radiusMeters;
            }
            await tx.insert(hrmsGeoAttendance).values({
                  id, tenantId: p.tenantId, employeeId: body.employeeId,
                  attendanceDate: today, checkType: "check_in",
                  latitude: body.latitude, longitude: body.longitude,
                  accuracyMeters: body.accuracyMeters ?? null,
                  officeLocationId: body.officeLocationId ?? officeLoc?.id ?? null,
                  withinGeofence, distanceFromOffice: distance,
                  selfieFileKey: body.selfieFileKey ?? null, selfieVerified: false,
                  deviceId: body.deviceId ?? null,
                  // The originating request's IP is unrecoverable here: the F3
                  // envelope (shared/f3-publish.ts) carries only {op,id,tenantId,
                  // body,params,query} — no headers and no req.ip. Persisting null
                  // rather than crashing; restoring the IP requires routes.ts to
                  // forward it in the published payload.
                  ipAddress: null,
                  createdBy: msg.actorId,
                } as any);
            break;
          }
          case "geo_attendance_routes__2": {
            // Same reconstruction as __1, for the geo-check-out route. Check-out
            // always resolves against the tenant's first active office (routes.ts
            // does not honour body.officeLocationId on this path).
            //
            // FIXED (migration 0127_widen_geo_attendance_check_type.sql): this
            // insert used to fail at Postgres with 22001 "value too long for
            // type character varying(8)" — attendance.hrms_geo_attendance.
            // check_type was varchar(8) and "check_out" is 9 characters, so NO
            // check-out row could ever be stored ("check_in" is exactly 8,
            // which is why check-in always worked). The column (and the
            // matching Drizzle declaration in ./schema.ts) is now varchar(16).
            const today = new Date().toISOString().slice(0, 10);
            const officeLoc = await resolveOfficeLoc(tx, p.tenantId, undefined);
            let withinGeofence = false;
            let distance: number | null = null;
            if (officeLoc) {
              distance = haversineMeters(Number(body.latitude), Number(body.longitude), officeLoc.latitude, officeLoc.longitude);
              withinGeofence = distance <= officeLoc.radiusMeters;
            }
            await tx.insert(hrmsGeoAttendance).values({
                  id, tenantId: p.tenantId, employeeId: body.employeeId,
                  attendanceDate: today, checkType: "check_out",
                  latitude: body.latitude, longitude: body.longitude,
                  accuracyMeters: body.accuracyMeters ?? null,
                  officeLocationId: officeLoc?.id ?? null,
                  withinGeofence, distanceFromOffice: distance,
                  selfieFileKey: body.selfieFileKey ?? null, selfieVerified: false,
                  deviceId: body.deviceId ?? null,
                  // See __1: request IP is not carried in the F3 envelope.
                  ipAddress: null,
                  createdBy: msg.actorId,
                } as any);
            break;
          }
        }
      });
    } catch (err) {
      log.error({ err, op, messageId: msg.messageId }, "f3RouteWrite failed");
      throw err;
    }
  });
}
