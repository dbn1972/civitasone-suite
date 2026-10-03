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
