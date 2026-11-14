import { and, eq, sql } from "drizzle-orm";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue } from "../../shared/outbox.js";
import { HttpError } from "../../shared/context.js";
import { fetchLocation } from "../../shared/location-client.js";
import { hrmsEmployees } from "./schema.js";
import { isExitedStatus } from "./status.js";
import type { EmployeeLocationBody, BulkEmployeeLocationBody } from "./validators.js";

const AUDIT = "audit.event.record";

export type EmployeeLocationResult = {
  id: string;
  locationId: string;
  previousLocationId: string | null;
  changed: boolean;
};

/**
 * Verifies, against location-service, that `locationId` is a real ACTIVE
 * location of the caller's tenant. Another tenant's id and an unknown id are
 * indistinguishable (both 422 LOCATION_NOT_FOUND). Fails CLOSED: if location-
 * service cannot be reached the answer is 503, never a silent assignment.
 */
export async function assertAssignableLocation(tenantId: string, locationId: string): Promise<void> {
  const loc = await fetchLocation(tenantId, locationId);
  if (!loc.ok) {
    if (loc.reason === "not_found") {
      throw new HttpError(422, "LOCATION_NOT_FOUND", "no location with this id exists in this organisation");
    }
    throw new HttpError(503, "LOCATION_UNAVAILABLE", "could not verify the location with location-service; try again");
  }
  if (loc.status !== "active") {
    throw new HttpError(409, "LOCATION_NOT_ACTIVE", `the location has status '${loc.status}' and cannot be assigned`);
  }
}

/**
 * Sets or changes an employee's location (hrms_employees.location_id), which
 * the generic PATCH /v1/hrms/employees/:id never carried. Synchronous, one
 * tenant-scoped transaction holding the row lock, the update and the audit
 * outbox event (old -> new), so the audit record exists iff the change does --
 * same shape as setEmployeeLoginLink. `verified` lets the bulk path validate
 * the (single) location once instead of once per employee.
 */
export async function setEmployeeLocation(
  ctx: RequestContext,
  employeeId: string,
  body: EmployeeLocationBody,
  opts: { verified?: boolean } = {},
): Promise<EmployeeLocationResult> {
  const tenantId = ctx.tenantId;
  if (!opts.verified) await assertAssignableLocation(tenantId, body.locationId);

  const result = await db.transaction(async (tx) => {
    const rows = await tx.select({ id: hrmsEmployees.id, status: hrmsEmployees.status, locationId: hrmsEmployees.locationId })
      .from(hrmsEmployees)
      .where(and(eq(hrmsEmployees.id, employeeId), eq(hrmsEmployees.tenantId, tenantId)))
      .for("update")
      .limit(1);
    const emp = rows[0];
    if (!emp) throw new HttpError(404, "NOT_FOUND", "employee not found");
    if (isExitedStatus(emp.status)) {
      throw new HttpError(409, "EMPLOYEE_EXITED", `employee has status '${emp.status}' and can no longer be updated via this endpoint`);
    }
    const previousLocationId = emp.locationId ?? null;
    if (previousLocationId === body.locationId) {
      return { id: employeeId, locationId: body.locationId, previousLocationId, changed: false };
    }

    await tx.update(hrmsEmployees)
      .set({ locationId: body.locationId, updatedBy: ctx.actorId, updatedAt: new Date(), version: sql`${hrmsEmployees.version} + 1` })
      .where(and(eq(hrmsEmployees.id, employeeId), eq(hrmsEmployees.tenantId, tenantId)));

    await enqueue(tx, {
      topic: AUDIT, eventType: AUDIT,
      tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
      payload: {
        service: "hrms",
        action: "location_change",
        resourceType: "employee",
        resourceId: employeeId,
        outcome: "success",
        oldValue: { locationId: previousLocationId },
        newValue: { locationId: body.locationId },
        reason: body.reason,
      },
    });
    return { id: employeeId, locationId: body.locationId, previousLocationId, changed: true };
  });

  if (result.changed) {
    await cache.invalidate(cache.makeKey(tenantId, "employee", employeeId));
    await cache.invalidateResource(tenantId, "employee");
  }
  return result;
}

export type BulkEmployeeLocationResult = {
  locationId: string;
  requested: number;
  updated: number;
  unchanged: number;
  failed: number;
  results: Array<
    | { id: string; outcome: "updated" | "unchanged"; previousLocationId: string | null }
    | { id: string; outcome: "failed"; code: string; message: string }
  >;
};

/**
 * Bulk variant: one location for up to BULK_LOCATION_MAX employees. The
 * location is verified ONCE up front (whole request refused if it is bad);
 * after that each employee is its own transaction + audit event, so one
 * exited / missing / other-tenant id is reported per id and never rolls back
 * or blocks the rest (partial success). Retrying is safe: already-moved
 * employees come back "unchanged" with no second audit event.
 */
export async function setEmployeeLocationBulk(ctx: RequestContext, body: BulkEmployeeLocationBody): Promise<BulkEmployeeLocationResult> {
  await assertAssignableLocation(ctx.tenantId, body.locationId);
  const results: BulkEmployeeLocationResult["results"] = [];
  for (const id of body.employeeIds) {
    try {
      const r = await setEmployeeLocation(ctx, id, { locationId: body.locationId, reason: body.reason }, { verified: true });
      results.push({ id, outcome: r.changed ? "updated" : "unchanged", previousLocationId: r.previousLocationId });
    } catch (err) {
      if (err instanceof HttpError) results.push({ id, outcome: "failed", code: err.code, message: err.message });
      else results.push({ id, outcome: "failed", code: "INTERNAL", message: "unexpected error" });
    }
  }
  return {
    locationId: body.locationId,
    requested: body.employeeIds.length,
    updated: results.filter((r) => r.outcome === "updated").length,
    unchanged: results.filter((r) => r.outcome === "unchanged").length,
    failed: results.filter((r) => r.outcome === "failed").length,
    results,
  };
}
