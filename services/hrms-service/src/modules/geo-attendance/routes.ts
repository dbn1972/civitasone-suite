import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead} from "../../shared/db.js";
import { hrmsGeoAttendance, hrmsOfficeLocations } from "./schema.js";
import { hrmsHolidays } from "../holidays/schema.js";
import { randomUUID } from "node:crypto";

const ALL_ROLES = ["super_admin", "admin", "hr_admin", "hr_officer", "officer", "employee"];
const HR_ROLES = ["super_admin", "admin", "hr_admin"];

/** Haversine distance in meters between two lat/lng points */
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const geoCheckInBody = z.object({
  employeeId: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().min(0).optional(),
  selfieFileKey: z.string().optional(),
  deviceId: z.string().optional(),
  officeLocationId: z.string().uuid().optional(),
});

export async function geoAttendanceRoutes(app: FastifyInstance): Promise<void> {
  // ── Office Locations CRUD ──
  app.get("/v1/hrms/office-locations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const rows = await scopedRead((tx) => tx.select().from(hrmsOfficeLocations).where(eq(hrmsOfficeLocations.tenantId, ctx.tenantId)));
    return reply.send({ data: rows.map(r => ({ id: r.id, name: r.name, address: r.address, latitude: r.latitude, longitude: r.longitude, radiusMeters: r.radiusMeters, isActive: r.isActive })) });
  });

  app.post("/v1/hrms/office-locations", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, HR_ROLES);
    const body = z.object({ name: z.string().min(1), address: z.string().optional(), latitude: z.number(), longitude: z.number(), radiusMeters: z.number().int().min(50).max(5000).default(200) }).parse(req.body);
    const id = randomUUID();
    await db.insert(hrmsOfficeLocations).values({ id, tenantId: ctx.tenantId, name: body.name, address: body.address ?? null, latitude: body.latitude, longitude: body.longitude, radiusMeters: body.radiusMeters, createdBy: ctx.actorId });
    return reply.code(201).send({ id, name: body.name, radiusMeters: body.radiusMeters });
  });

  // ── Geo Check-In (Video/Selfie + Location) ──
  app.post("/v1/hrms/attendance/geo-check-in", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const body = geoCheckInBody.parse(req.body);
    const today = new Date().toISOString().slice(0, 10);

    // 1. Check if today is a holiday
    const holidays = await scopedRead((tx) => tx.select().from(hrmsHolidays)
      .where(and(eq(hrmsHolidays.tenantId, ctx.tenantId), eq(hrmsHolidays.date, today))));
    const isGazettedHoliday = holidays.some(h => h.type === "gazetted");
    if (isGazettedHoliday) {
      throw new HttpError(400, "HOLIDAY", `Today (${today}) is a gazetted holiday: ${holidays[0]?.name ?? "holiday"}. Attendance not required.`);
    }

    // 2. Get employee's assigned office location (or use provided one)
    let officeLoc: { latitude: number; longitude: number; radiusMeters: number; name: string } | null = null;
    if (body.officeLocationId) {
      const rows = await scopedRead((tx) => tx.select().from(hrmsOfficeLocations)
        .where(and(eq(hrmsOfficeLocations.id, body.officeLocationId!), eq(hrmsOfficeLocations.tenantId, ctx.tenantId))));
      if (rows[0]) officeLoc = rows[0];
    } else {
      // Fallback: get first active office
      const rows = await scopedRead((tx) => tx.select().from(hrmsOfficeLocations)
        .where(and(eq(hrmsOfficeLocations.tenantId, ctx.tenantId), eq(hrmsOfficeLocations.isActive, true))).limit(1));
      if (rows[0]) officeLoc = rows[0];
    }

    // 3. Calculate distance and geo-fence check
    let withinGeofence = false;
    let distance: number | null = null;
    if (officeLoc) {
      distance = haversineMeters(body.latitude, body.longitude, officeLoc.latitude, officeLoc.longitude);
      withinGeofence = distance <= officeLoc.radiusMeters;
    }

    // 4. Store geo-attendance record
    const id = randomUUID();
    await db.insert(hrmsGeoAttendance).values({
      id, tenantId: ctx.tenantId, employeeId: body.employeeId,
      attendanceDate: today, checkType: "check_in",
      latitude: body.latitude, longitude: body.longitude,
      accuracyMeters: body.accuracyMeters ?? null,
      officeLocationId: body.officeLocationId ?? (officeLoc as any)?.id ?? null,
      withinGeofence, distanceFromOffice: distance,
      selfieFileKey: body.selfieFileKey ?? null, selfieVerified: false,
      deviceId: body.deviceId ?? null,
      ipAddress: (req.headers["x-forwarded-for"] as string) ?? req.ip ?? null,
      createdBy: ctx.actorId,
    } as any);

    return reply.code(201).send({
      id, status: withinGeofence ? "within_geofence" : "outside_geofence",
      distanceMeters: distance ? Math.round(distance) : null,
      officeName: officeLoc?.name ?? null,
      radiusMeters: officeLoc?.radiusMeters ?? null,
      isHoliday: false, holidayName: null,
      message: withinGeofence ? "Check-in recorded within office boundary" : `Check-in recorded but you are ${Math.round(distance ?? 0)}m away from office (limit: ${officeLoc?.radiusMeters ?? '?'}m)`,
    });
  });

  // ── Geo Check-Out ──
  app.post("/v1/hrms/attendance/geo-check-out", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const body = geoCheckInBody.parse(req.body);
    const today = new Date().toISOString().slice(0, 10);

    let officeLoc: any = null;
    const rows = await scopedRead((tx) => tx.select().from(hrmsOfficeLocations)
      .where(and(eq(hrmsOfficeLocations.tenantId, ctx.tenantId), eq(hrmsOfficeLocations.isActive, true))).limit(1));
    if (rows[0]) officeLoc = rows[0];

    let withinGeofence = false;
    let distance: number | null = null;
    if (officeLoc) {
      distance = haversineMeters(body.latitude, body.longitude, officeLoc.latitude, officeLoc.longitude);
      withinGeofence = distance <= officeLoc.radiusMeters;
    }

    const id = randomUUID();
    await db.insert(hrmsGeoAttendance).values({
      id, tenantId: ctx.tenantId, employeeId: body.employeeId,
      attendanceDate: today, checkType: "check_out",
      latitude: body.latitude, longitude: body.longitude,
      accuracyMeters: body.accuracyMeters ?? null,
      officeLocationId: officeLoc?.id ?? null,
      withinGeofence, distanceFromOffice: distance,
      selfieFileKey: body.selfieFileKey ?? null, selfieVerified: false,
      deviceId: body.deviceId ?? null, ipAddress: req.ip ?? null,
      createdBy: ctx.actorId,
    } as any);

    return reply.code(201).send({ id, status: "check_out_recorded", withinGeofence, distanceMeters: distance ? Math.round(distance) : null });
  });

  // ── Get my geo attendance history ──
  app.get("/v1/hrms/attendance/geo-history", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = z.object({ employeeId: z.string().uuid().optional() }).parse(req.query);
    const empId = q.employeeId ?? ctx.actorId;
    const rows = await scopedRead((tx) => tx.select().from(hrmsGeoAttendance)
      .where(and(eq(hrmsGeoAttendance.tenantId, ctx.tenantId), eq(hrmsGeoAttendance.employeeId, empId))));
    return reply.send({ data: rows.slice(0, 60).map(r => ({ id: r.id, date: r.attendanceDate, checkType: r.checkType, withinGeofence: r.withinGeofence, distanceMeters: r.distanceFromOffice ? Math.round(r.distanceFromOffice) : null, markedAt: r.markedAt, selfieFileKey: r.selfieFileKey })) });
  });

  // ── Reporting Officer: Get my reportees' attendance ──
  app.get("/v1/hrms/attendance/reportees", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    // In real system: query employees where reporting_officer_id = ctx.actorId
    // For now return geo attendance for all employees (HR admin view)
    const rows = await scopedRead((tx) => tx.select().from(hrmsGeoAttendance)
      .where(eq(hrmsGeoAttendance.tenantId, ctx.tenantId)));
    return reply.send({ data: rows.slice(0, 100).map(r => ({ employeeId: r.employeeId, date: r.attendanceDate, checkType: r.checkType, withinGeofence: r.withinGeofence, distanceMeters: r.distanceFromOffice ? Math.round(r.distanceFromOffice) : null })) });
  });
}
