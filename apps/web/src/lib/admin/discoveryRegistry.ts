/**
 * GAP-ADMIN-DISCOVERY-02: the service-discovery payload model. Pure and client-safe on purpose:
 * the server loader maps the first read with it and the "Scan now" button maps the refresh with it,
 * and the loader module itself is server-only (it reads the session cookie).
 */
export type DiscoveryService = { serviceName: string; port: number | null; status: string; httpStatus: number | null };
export type DiscoveryRegistry = { services: DiscoveryService[]; checkedAt: string | null; overall: string | null; throttled: boolean };

const rec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

/** Maps GET /v1/admin/discovery/services; null when the payload is not a registry (so it surfaces as an error, never as "empty"). */
export function mapDiscoveryRegistry(p: unknown): DiscoveryRegistry | null {
  const rows = Array.isArray(p) ? p : rec(p) && Array.isArray(p.data) ? p.data : null;
  if (!rows) return null;
  const meta = rec(p) && rec(p.meta) ? p.meta : {};
  return {
    services: rows.filter(rec).map((r) => ({
      serviceName: String(r.serviceName ?? ""),
      port: typeof r.port === "number" ? r.port : null,
      status: String(r.status ?? ""),
      httpStatus: typeof r.httpStatus === "number" ? r.httpStatus : null,
    })),
    checkedAt: text(meta.checkedAt),
    overall: text(meta.overall),
    throttled: meta.throttled === true,
  };
}
