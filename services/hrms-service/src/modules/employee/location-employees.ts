import type { FastifyInstance } from "fastify";
import { and, asc, count, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { z, ZodError } from "zod";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { scopedRead } from "../../shared/db.js";
import { fetchLocationDescendantIds } from "../../shared/location-client.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "./schema.js";
import { EMPLOYEE_STATUSES, EXITED_STATUSES } from "./status.js";

/**
 * GAP-HR-LOCATIONS-03: the tenant's employees assigned to one location
 * (hrms_employees.location_id). HR roles only -- this is a tenant-wide roster
 * by location, unlike the manager-scoped directory list.
 */
const LOCATION_EMPLOYEE_ROLES = ["hr_admin", "hr_officer", "super_admin"];

const locationIdParam = z.object({ locationId: z.string().uuid() });

const locationEmployeesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  includeSubLocations: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // "active" (default) = every status except the permanent exits; "all" = no
  // status filter; otherwise an exact canonical status.
  status: z.enum(["active", "all", ...EMPLOYEE_STATUSES]).default("active"),
  q: z.string().trim().min(1).max(100).optional(),
});

export type LocationEmployeeRow = {
  id: string;
  employeeNo: string;
  name: string;
  designation: string;
  department: string;
  status: string;
};

export type LocationEmployeesResult = {
  data: LocationEmployeeRow[];
  total: number;
  limit: number;
  offset: number;
  /**
   * Employees (same status filter, ORGANISATION-WIDE, not scoped to this location) whose location is free text
   * only -- `station` set but no `location_id` -- and so are not listed on any
   * location page. Lets the page say "N employees have an unlinked location".
   */
  unlinkedCount: number;
};

const EXITED = [...EXITED_STATUSES] as string[];

/** Escapes LIKE wildcards so a user-typed % or _ is literal. */
function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export async function listEmployeesAtLocations(
  tenantId: string,
  locationIds: string[],
  q: { limit: number; offset: number; status: string; q?: string | undefined },
): Promise<LocationEmployeesResult> {
  const statusCond =
    q.status === "all" ? undefined
    : q.status === "active" ? notInArray(hrmsEmployees.status, EXITED)
    : eq(hrmsEmployees.status, q.status);
  const search = q.q
    ? sql`(${hrmsEmployees.fullName} ILIKE ${likePattern(q.q)} OR ${hrmsEmployees.employeeNo} ILIKE ${likePattern(q.q)})`
    : undefined;
  const where = and(
    eq(hrmsEmployees.tenantId, tenantId),
    inArray(hrmsEmployees.locationId, locationIds),
    statusCond,
    search,
  );

  return scopedRead(async (tx) => {
    const [{ n } = { n: 0 }] = await tx.select({ n: count() }).from(hrmsEmployees).where(where);
    const rows = await tx
      .select({
        id: hrmsEmployees.id,
        employeeNo: hrmsEmployees.employeeNo,
        name: hrmsEmployees.fullName,
        status: hrmsEmployees.status,
        department: hrmsDepartments.name,
        designation: hrmsDesignations.name,
      })
      .from(hrmsEmployees)
      .leftJoin(hrmsDepartments, and(eq(hrmsDepartments.id, hrmsEmployees.departmentId), eq(hrmsDepartments.tenantId, tenantId)))
      .leftJoin(hrmsDesignations, and(eq(hrmsDesignations.id, hrmsEmployees.designationId), eq(hrmsDesignations.tenantId, tenantId)))
      .where(where)
      // Stable: name, then id (ids are unique, so offset paging never repeats or skips a row).
      .orderBy(asc(hrmsEmployees.fullName), asc(hrmsEmployees.id))
      .limit(q.limit)
      .offset(q.offset);
    const [{ u } = { u: 0 }] = await tx
      .select({ u: count() })
      .from(hrmsEmployees)
      .where(and(
        eq(hrmsEmployees.tenantId, tenantId),
        isNull(hrmsEmployees.locationId),
        sql`coalesce(btrim(${hrmsEmployees.station}), '') <> ''`,
        statusCond,
      ));
    return {
      data: rows.map((r) => ({
        id: r.id,
        employeeNo: r.employeeNo,
        name: r.name,
        designation: r.designation ?? "—",
        department: r.department ?? "—",
        status: r.status,
      })),
      total: Number(n),
      limit: q.limit,
      offset: q.offset,
      unlinkedCount: Number(u),
    };
  });
}

export async function locationEmployeeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/v1/hrms/locations/:locationId/employees", async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, LOCATION_EMPLOYEE_ROLES);
    const { locationId } = locationIdParam.parse(req.params);
    const q = locationEmployeesQuery.parse(req.query);

    // Always resolve through location-service: it owns the location schema, so
    // this doubles as the existence check (unknown / other-tenant id -> 404,
    // never a 200 with an empty roster). The descendant ids are only used when
    // the caller asked for sub-locations.
    const lookup = await fetchLocationDescendantIds(ctx.tenantId, locationId);
    if (!lookup.ok) {
      if (lookup.reason === "not_found") throw new HttpError(404, "NOT_FOUND", "location not found");
      throw new HttpError(502, "LOCATION_SERVICE_UNAVAILABLE", "The location could not be resolved right now. Try again.");
    }
    const locationIds = q.includeSubLocations ? [locationId, ...lookup.descendantIds] : [locationId];
    return reply.send(await listEmployeesAtLocations(ctx.tenantId, locationIds, q));
  });

  // Same typed error contract as the sibling employee routes: a bad query is a
  // 400 with field errors, an HttpError keeps its status/code.
  app.setErrorHandler((err, req, reply) => {
    const correlationId = (req.headers["x-correlation-id"] as string) ?? req.id;
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: "VALIDATION_FAILED", message: "invalid request", correlationId, retryable: false,
        fieldErrors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
    }
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ code: err.code, message: err.message, correlationId, retryable: false });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ code: "INTERNAL", message: "internal error", correlationId, retryable: true });
  });
}
