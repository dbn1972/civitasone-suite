import type { Queue } from "@civitasone/queue";
import { pino } from "pino";
import { and, eq, desc, asc, sql, inArray, isNull, isNotNull, ne, or, gt, lt, gte, lte } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { hrmsGeoAttendance, hrmsOfficeLocations } from "./schema.js";
import { hrmsHolidays } from "../holidays/schema.js";
const log = pino({ name: "hrms-f3-geo-attendance" });
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
            await tx.insert(hrmsGeoAttendance).values({
                  id, tenantId: p.tenantId, employeeId: body.employeeId,
                  attendanceDate: today, checkType: "check_in",
                  latitude: body.latitude, longitude: body.longitude,
                  accuracyMeters: body.accuracyMeters ?? null,
                  officeLocationId: body.officeLocationId ?? (officeLoc as any)?.id ?? null,
                  withinGeofence, distanceFromOffice: distance,
                  selfieFileKey: body.selfieFileKey ?? null, selfieVerified: false,
                  deviceId: body.deviceId ?? null,
                  ipAddress: (req.headers["x-forwarded-for"] as string) ?? req.ip ?? null,
                  createdBy: msg.actorId,
                } as any);
            break;
          }
          case "geo_attendance_routes__2": {
            await tx.insert(hrmsGeoAttendance).values({
                  id, tenantId: p.tenantId, employeeId: body.employeeId,
                  attendanceDate: today, checkType: "check_out",
                  latitude: body.latitude, longitude: body.longitude,
                  accuracyMeters: body.accuracyMeters ?? null,
                  officeLocationId: officeLoc?.id ?? null,
                  withinGeofence, distanceFromOffice: distance,
                  selfieFileKey: body.selfieFileKey ?? null, selfieVerified: false,
                  deviceId: body.deviceId ?? null, ipAddress: req.ip ?? null,
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
