const HRMS_URL = process.env.HRMS_SERVICE_URL ?? "http://127.0.0.1:3012";

export type LocationEmployeeCount =
  | { ok: true; total: number }
  | { ok: false; reason: "unavailable" };

/**
 * GAP-LOCATIONS-LIST-04: how many of the tenant's current (non-exited) employees are posted at
 * `locationId`, read from hrms-service over the same x-internal + service-secret boundary every
 * other internal call uses (hrms owns the employee schema; location-service never queries it).
 * The tenant is always the caller's own, so the count is tenant-scoped on the owning side.
 *
 * Fails CLOSED: any error, timeout, non-2xx or malformed body answers "unavailable" so the caller
 * can refuse to archive rather than orphan employees that it could not see.
 */
export async function countActiveEmployeesAt(tenantId: string, locationId: string): Promise<LocationEmployeeCount> {
  try {
    const res = await fetch(
      `${HRMS_URL}/v1/hrms/locations/${encodeURIComponent(locationId)}/employees?limit=1&status=active`,
      {
        headers: {
          "x-internal": "1",
          "x-internal-caller": "location-service",
          "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
          "x-tenant-id": tenantId,
        },
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const body = (await res.json()) as { total?: unknown };
    if (typeof body.total !== "number" || !Number.isInteger(body.total) || body.total < 0) {
      return { ok: false, reason: "unavailable" };
    }
    return { ok: true, total: body.total };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
