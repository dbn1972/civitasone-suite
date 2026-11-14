const LOCATION_URL = process.env.LOCATION_SERVICE_URL ?? "http://127.0.0.1:4012";

export type LocationHierarchyLookup =
  | { ok: true; descendantIds: string[] }
  | { ok: false; reason: "not_found" | "unavailable" };

/**
 * Descendant location ids of `locationId`, read from location-service over the
 * same x-internal + service-secret boundary every other internal call in this
 * service uses (location-service owns the location schema; hrms never queries
 * it). The tenant is always the caller's own, so the walk is tenant-scoped on
 * the owning side. Fails CLOSED: a non-404 error / timeout answers
 * "unavailable" so the caller can refuse rather than silently list only the
 * top-level location's employees as if that were the whole subtree.
 */
export async function fetchLocationDescendantIds(tenantId: string, locationId: string): Promise<LocationHierarchyLookup> {
  try {
    const res = await fetch(`${LOCATION_URL}/v1/locations/${encodeURIComponent(locationId)}/hierarchy`, {
      headers: {
        "x-internal": "1",
        "x-internal-caller": "hrms-service",
        "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
        "x-tenant-id": tenantId,
      },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404) return { ok: false, reason: "not_found" };
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const body = (await res.json()) as { descendantIds?: unknown };
    if (!Array.isArray(body.descendantIds) || !body.descendantIds.every((v) => typeof v === "string")) {
      return { ok: false, reason: "unavailable" };
    }
    return { ok: true, descendantIds: body.descendantIds as string[] };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}

export type LocationLookup =
  | { ok: true; id: string; status: string }
  | { ok: false; reason: "not_found" | "unavailable" };

/**
 * Existence + status of one location in the caller's OWN tenant, read from
 * location-service's read-only hierarchy endpoint (the same trusted internal
 * boundary as above; the tenant is sent as x-tenant-id so a location id from
 * another tenant answers 404, exactly like an unknown id). Fails CLOSED: any
 * other error, timeout or malformed body is "unavailable" so a caller refuses
 * rather than assigning an employee to a location it could not verify.
 */
export async function fetchLocation(tenantId: string, locationId: string): Promise<LocationLookup> {
  try {
    const res = await fetch(`${LOCATION_URL}/v1/locations/${encodeURIComponent(locationId)}/hierarchy`, {
      headers: {
        "x-internal": "1",
        "x-internal-caller": "hrms-service",
        "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "",
        "x-tenant-id": tenantId,
      },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404) return { ok: false, reason: "not_found" };
    if (!res.ok) return { ok: false, reason: "unavailable" };
    const body = (await res.json()) as { location?: { id?: unknown; tenantId?: unknown; status?: unknown } };
    const loc = body.location;
    if (!loc || loc.id !== locationId || typeof loc.status !== "string") return { ok: false, reason: "unavailable" };
    // Defence in depth: never trust the owning side's scoping alone.
    if (typeof loc.tenantId === "string" && loc.tenantId !== tenantId) return { ok: false, reason: "not_found" };
    return { ok: true, id: loc.id, status: loc.status };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
