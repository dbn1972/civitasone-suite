/**
 * UAT Phase 2 C7 (recon D14): bills raised from a procurement GRN cite the
 * procurement vendor id, which finance's own vendor master does not hold, so
 * every such bill read "Unknown vendor". This read-only client resolves those
 * ids to the vendor's registered name via procurement-service's internal
 * id -> name lookup (x-internal + x-service-secret + x-tenant-id, bounded
 * timeout), the same elevation as identity-client.ts.
 *
 * Display-only enrichment, so it fails OPEN: an unreachable or erroring
 * procurement-service yields an empty Map and the caller keeps its neutral
 * "Unknown vendor" label. It never breaks the finance read.
 */
const PROCUREMENT_URL = process.env.PROCUREMENT_SERVICE_URL ?? "http://127.0.0.1:3008";
const MAX_IDS = 100;

export async function fetchProcurementVendorNames(tenantId: string, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))].slice(0, MAX_IDS);
  if (unique.length === 0) return new Map();
  try {
    const res = await fetch(`${PROCUREMENT_URL}/v1/procurement/internal/vendor-names?ids=${encodeURIComponent(unique.join(","))}`, {
      headers: { "x-internal": "1", "x-service-secret": process.env.INTERNAL_SERVICE_SECRET ?? "", "x-tenant-id": tenantId },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return new Map();
    const body = (await res.json()) as { data?: Array<{ id?: unknown; name?: unknown }> };
    const out = new Map<string, string>();
    for (const r of body.data ?? []) {
      if (typeof r.id === "string" && typeof r.name === "string" && r.name.trim()) out.set(r.id, r.name);
    }
    return out;
  } catch {
    return new Map();
  }
}
