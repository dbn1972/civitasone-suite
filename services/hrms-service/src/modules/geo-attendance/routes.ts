import { randomUUID } from "node:crypto";
import { publishF3Write } from "../../shared/f3-publish.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import { eq, and, inArray } from "drizzle-orm";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { db, scopedRead} from "../../shared/db.js";
import { hrmsGeoAttendance, hrmsOfficeLocations } from "./schema.js";
import { hrmsHolidays } from "../holidays/schema.js";
import { hrmsEmployees } from "../employee/schema.js";
import { resolveEmployeeForActor } from "../employee/actor-link.js";
import { isExitedStatus } from "../employee/status.js";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { RequestContext } from "@civitasone/types";

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

/**
 * SEC CRITICAL (IDOR fix): geo-check-in/out used to take `employeeId` from
 * the request BODY, under ALL_ROLES (which includes bare "employee"), with
 * NO check that it matched the caller — any authenticated user could clock
 * in/out as any other employee by simply naming a different id, and neither
 * this route nor its F3 consumer (f3-consumer.ts) ever queried
 * hrms_employees to notice. This is a GPS + selfie "I am physically here"
 * punch, so "mark attendance on behalf of someone else" has no coherent
 * meaning for this specific endpoint the way it might for a manual
 * attendance-regularisation workflow elsewhere — and no such on-behalf-of
 * workflow exists anywhere in this module (checked: the only other routes
 * here are office-locations CRUD, geo-history and reportees, none of which
 * write an attendance row for anyone other than the row's own subject).
 * Default: self-only for EVERY role, including HR/admin/super_admin — HR
 * staff punch in through this same endpoint for their own attendance like
 * anyone else. A caller with no resolvable hrms_employees record at all
 * (e.g. a pure system/admin account) fails closed, same convention as
 * employee/routes.ts's resolveManagerScope.
 *
 * Also ties back to the Bug 1 status-integrity theme: a terminated/
 * separated/retired employee shouldn't be clockable-in at all. Free to check
 * here since resolveEmployeeForActor already returns the full row (status
 * included) — no extra query.
 */
async function resolveSelfEmployeeOrThrow(
  ctx: RequestContext, req: FastifyRequest, claimedEmployeeId: string,
): Promise<{ id: string }> {
  const self = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
  if (!self) {
    throw new HttpError(403, "NO_EMPLOYEE_RECORD", "no employee record is linked to this account; attendance cannot be recorded");
  }
  if (claimedEmployeeId !== self.id) {
    throw new HttpError(403, "FORBIDDEN", "you may only record attendance for yourself");
  }
  if (isExitedStatus(self.status)) {
    throw new HttpError(409, "EMPLOYEE_EXITED", `attendance cannot be recorded — employee status is '${self.status}'`);
  }
  return { id: self.id };
}

/**
 * GAP-HR-ATTENDANCE-05 (SEC): GET .../attendance/geo-history used to default
 * an omitted `employeeId` to `ctx.actorId` (the auth-account id, not
 * hrms_employees.id -- see GeoCheckInCard.tsx's doc comment for why those two
 * id spaces differ) AND placed no restriction at all on an *explicit*
 * `employeeId` query param -- any authenticated caller under ALL_ROLES
 * (which includes bare "employee") could read another employee's geo
 * check-in/out history, including a selfie file key and precise location
 * data, by simply naming a different uuid. Pure decision function (no DB
 * access) so the authorization rule itself is directly unit-testable without
 * a Fastify/DB harness -- mirrors attendance/routes.ts's
 * resolveSelfScopedEmployeeId / isSelfApproval / assertSelfOrHr style of
 * extracting the IDOR guard out of the handler body.
 *
 * Rules:
 *  - no employeeId given -> self (from the caller's own resolved employee
 *    record); 403 if the caller has no linked employee record at all.
 *  - employeeId given and it IS the caller's own id -> self, no role check
 *    needed.
 *  - employeeId given and it's SOMEONE ELSE's (or the caller has no linked
 *    employee record to compare against) -> requires this module's own
 *    HR_ROLES (the same admin tier already gating office-locations POST
 *    just above), else 403.
 */
export function resolveGeoHistoryScope(
  roles: string[],
  selfEmployeeId: string | null,
  requestedEmployeeId: string | undefined,
): string {
  if (requestedEmployeeId && requestedEmployeeId !== selfEmployeeId) {
    if (!HR_ROLES.some((r) => roles.includes(r))) {
      throw new HttpError(403, "FORBIDDEN", "you may only view your own geo-attendance history");
    }
    return requestedEmployeeId;
  }
  if (selfEmployeeId) return selfEmployeeId;
  throw new HttpError(
    403,
    "NO_EMPLOYEE_RECORD",
    "no employee record is linked to this account; pass employeeId to look up another employee's history",
  );
}

/**
 * GAP-HR-ATTENDANCE-REPORTEES-01 (SEC/DPDP): GET .../attendance/reportees
 * was a never-finished stub — `requireRole(ctx, ALL_ROLES)` (which includes
 * bare "employee") gated entry, but the query itself had no employeeId/
 * manager filter at all ("For now return geo attendance for all employees
 * (HR admin view)"), so ANY authenticated caller in this tenant, of any
 * role, got the first 100 geo-attendance rows tenant-wide: every employee's
 * check-in/out location and geofence status. Found as a direct sibling of
 * GAP-HR-ATTENDANCE-05 (this same file's geo-history fix, see
 * resolveGeoHistoryScope-equivalent reasoning below) while fixing that PR;
 * deliberately not folded into it there to keep that PR narrowly scoped to
 * the single-employee history endpoint.
 *
 * Scoping decision: this module's own role vocabulary (ALL_ROLES/HR_ROLES
 * above) has no "manager" string at all — it uses "officer" for what other
 * modules (leave/routes.ts, employee/routes.ts, medical/routes.ts's
 * GAP-HR-MEDICAL-01 fix) call "manager". Gating on a specific non-HR role
 * name here would just be one more inconsistent, drift-prone convention (see
 * this campaign's own "verify relayed identifiers" lesson — re-derive from
 * source rather than trust a role string carried over from a sibling
 * module). Instead this resolves "my reportees" from the actual data
 * relationship, hrms_employees.managerId, the same column leave/routes.ts's
 * resolveNonHrEmployeeScope and GAP-HR-MEDICAL-01's manager-scope fix both
 * use — so it is correct regardless of which specific role name a reporting
 * officer happens to hold.
 *
 * Rules:
 *  - HR_ROLES (this module's existing admin tier, already used above for
 *    office-locations POST): unchanged tenant-wide view — the route's
 *    original "HR admin view" intent, now actually gated to HR instead of
 *    everyone.
 *  - everyone else: resolved via resolveEmployeeForActor, then their real
 *    direct reports (hrms_employees.managerId = their own id). No linked
 *    employee record, or a linked one with zero direct reports, returns an
 *    empty employeeIds array — the handler must treat that as "nothing to
 *    show" and never fall back to an unscoped query (fails CLOSED, mirrors
 *    resolveGeoHistoryScope's NO_EMPLOYEE_RECORD case just above and
 *    GAP-HR-MEDICAL-01's identical fail-closed manager branch — the
 *    difference here is an empty list rather than a 403, since "you have no
 *    reportees" is not a forbidden request, just an empty one).
 */
async function resolveReporteesScope(
  ctx: RequestContext,
): Promise<{ employeeIds: string[] | null; scopedToManagerId: string | null }> {
  if (HR_ROLES.some((r) => ctx.roles.includes(r))) {
    return { employeeIds: null, scopedToManagerId: null }; // null = tenant-wide (HR admin view, unchanged)
  }
  const actorEmp = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
  if (!actorEmp) return { employeeIds: [], scopedToManagerId: null };
  const reports = await scopedRead((tx) => tx.select({ id: hrmsEmployees.id }).from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.tenantId, ctx.tenantId), eq(hrmsEmployees.managerId, actorEmp.id))));
  return { employeeIds: reports.map((r) => r.id), scopedToManagerId: actorEmp.id };
}

/**
 * DPDP: audits a privileged bulk read of other employees' geo-attendance
 * (precise location + geofence status) — HR's tenant-wide view, or a
 * reporting officer's real-direct-reports view. Never called for the
 * fail-closed empty-list case (nothing was actually disclosed there).
 * Fire-and-forget via the async outbox, same shape as GAP-HR-MEDICAL-01's
 * auditMedicalClaimsListRead: this route must not write to Postgres
 * directly, so the actual insert happens in this module's own consumer.ts,
 * in its new geoAttendanceReporteesRead subscriber.
 */
async function auditReporteesListRead(
  ctx: RequestContext,
  details: { scopedToManagerId: string | null; tenantWide: boolean; rowCount: number },
): Promise<void> {
  await queue.publish(COMMANDS.geoAttendanceReporteesRead, {
    messageId: randomUUID(),
    type: COMMANDS.geoAttendanceReporteesRead,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      service: "hrms",
      action: "list",
      resourceType: "geo_attendance_reportees",
      resourceId: details.scopedToManagerId ?? "tenant_list",
      outcome: "success",
      rowCount: details.rowCount,
      filter: { tenantWide: details.tenantWide },
    },
  });
}

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
    await publishF3Write(ctx, "geo_attendance_routes__0", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })
    return reply.code(201).send({ id, name: body.name, radiusMeters: body.radiusMeters }) as any;
  });

  // ── Geo Check-In (Video/Selfie + Location) ──
  app.post("/v1/hrms/attendance/geo-check-in", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const body = geoCheckInBody.parse(req.body);
    await resolveSelfEmployeeOrThrow(ctx, req, body.employeeId);
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
    await publishF3Write(ctx, "geo_attendance_routes__1", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })

    return reply.code(201).send({
      id, status: withinGeofence ? "within_geofence" : "outside_geofence",
      distanceMeters: distance ? Math.round(distance) : null,
      officeName: officeLoc?.name ?? null,
      radiusMeters: officeLoc?.radiusMeters ?? null,
      isHoliday: false, holidayName: null,
      message: withinGeofence ? "Check-in recorded within office boundary" : `Check-in recorded but you are ${Math.round(distance ?? 0)}m away from office (limit: ${officeLoc?.radiusMeters ?? '?'}m)`,
    }) as any;
  });

  // ── Geo Check-Out ──
  app.post("/v1/hrms/attendance/geo-check-out", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const body = geoCheckInBody.parse(req.body);
    await resolveSelfEmployeeOrThrow(ctx, req, body.employeeId);
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
    await publishF3Write(ctx, "geo_attendance_routes__2", id, { body: (req.body as Record<string, unknown>) ?? {}, params: req.params as Record<string, unknown>, query: req.query as Record<string, unknown> })

    return reply.code(201).send({ id, status: "check_out_recorded", withinGeofence, distanceMeters: distance ? Math.round(distance) : null }) as any;
  });

  // ── Get my geo attendance history ──
  app.get("/v1/hrms/attendance/geo-history", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const q = z.object({ employeeId: z.string().uuid().optional() }).parse(req.query);
    const self = await resolveEmployeeForActor(ctx.tenantId, ctx.actorId);
    const empId = resolveGeoHistoryScope(ctx.roles, self?.id ?? null, q.employeeId);
    const rows = await scopedRead((tx) => tx.select().from(hrmsGeoAttendance)
      .where(and(eq(hrmsGeoAttendance.tenantId, ctx.tenantId), eq(hrmsGeoAttendance.employeeId, empId))));
    return reply.send({ data: rows.slice(0, 60).map(r => ({ id: r.id, date: r.attendanceDate, checkType: r.checkType, withinGeofence: r.withinGeofence, distanceMeters: r.distanceFromOffice ? Math.round(r.distanceFromOffice) : null, markedAt: r.markedAt, selfieFileKey: r.selfieFileKey })) });
  });

  // ── Reporting Officer: Get my reportees' attendance ──
  app.get("/v1/hrms/attendance/reportees", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, ALL_ROLES);
    const scope = await resolveReporteesScope(ctx);
    // Fail CLOSED: no linked employee record, or a linked one with zero
    // real direct reports — never fall back to the old unscoped query.
    if (scope.employeeIds !== null && scope.employeeIds.length === 0) {
      return reply.send({ data: [] });
    }
    const rows = await scopedRead((tx) => tx.select().from(hrmsGeoAttendance)
      .where(scope.employeeIds === null
        ? eq(hrmsGeoAttendance.tenantId, ctx.tenantId)
        : and(eq(hrmsGeoAttendance.tenantId, ctx.tenantId), inArray(hrmsGeoAttendance.employeeId, scope.employeeIds))));
    // Field list deliberately excludes selfieFileKey — unlike geo-history
    // (a self-or-HR single-employee "detail" view), this is a multi-employee
    // "list" view, and this campaign's own list-vs-detail convention
    // (GAP-HR-MEDICAL-01's list route dropping diagnosis/documents/remarks)
    // is that a bulk list stays minimal even for a caller allowed to see the
    // rows at all — a reporting officer has no need to see a report's selfie
    // just to confirm they attended.
    const data = rows.slice(0, 100).map(r => ({ employeeId: r.employeeId, date: r.attendanceDate, checkType: r.checkType, withinGeofence: r.withinGeofence, distanceMeters: r.distanceFromOffice ? Math.round(r.distanceFromOffice) : null }));
    await auditReporteesListRead(ctx, { scopedToManagerId: scope.scopedToManagerId, tenantWide: scope.employeeIds === null, rowCount: data.length });
    return reply.send({ data });
  });

  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({ code: "VALIDATION_FAILED", message: "invalid request", correlationId, fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })) });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ code: err.code, message: err.message, correlationId });
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId });
  });
}
