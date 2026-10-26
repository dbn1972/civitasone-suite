/**
 * Org-hierarchy CLIENT (owner decisions #10, #11, #13): legal-service stores a department
 * ID from the authoritative org hierarchy (hrms-service departments) and resolves the
 * name for display. Read-only, over the platform's service-to-service auth
 * (x-internal + x-tenant-id + x-service-secret). Callers never see the upstream message.
 */
import { pino } from "pino";

const log = pino({ name: "legal-org-client" });

export interface Department { id: string; name: string; code: string }
export interface OrgCallCtx { tenantId: string; correlationId: string }
export interface OrgClient { listDepartments(ctx: OrgCallCtx): Promise<Department[]> }

export class OrgServiceError extends Error {
  constructor(public readonly kind: "unavailable" | "not_configured", detail: string) {
    super(detail);
    this.name = "OrgServiceError";
  }
}

export interface OrgHttpOptions { baseUrl?: string; secret?: string; fetchImpl?: typeof fetch; timeoutMs?: number; ttlMs?: number }

export function createHttpOrgClient(opts: OrgHttpOptions = {}): OrgClient {
  const base = (opts.baseUrl ?? process.env.HRMS_SERVICE_URL ?? "http://127.0.0.1:3012").replace(/\/$/, "");
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? Number(process.env.ORG_SERVICE_TIMEOUT_MS ?? 5000);
  const ttlMs = opts.ttlMs ?? 60_000;
  const cache = new Map<string, { at: number; rows: Department[] }>();

  return {
    async listDepartments(ctx) {
      const hit = cache.get(ctx.tenantId);
      if (hit && Date.now() - hit.at < ttlMs) return hit.rows;
      const secret = opts.secret ?? process.env.INTERNAL_SERVICE_SECRET ?? "";
      if (!secret) throw new OrgServiceError("not_configured", "INTERNAL_SERVICE_SECRET is not set");
      let res: Response;
      try {
        res = await doFetch(`${base}/v1/hrms/departments`, {
          headers: {
            "x-internal": "1", "x-tenant-id": ctx.tenantId, "x-service-secret": secret,
            "x-internal-caller": "legal-service", "x-correlation-id": ctx.correlationId,
          },
          signal: AbortSignal.timeout(timeoutMs),
          redirect: "manual",
        });
      } catch (err) {
        log.error({ err: err instanceof Error ? err.message : String(err) }, "org service call failed");
        throw new OrgServiceError("unavailable", "org service unreachable");
      }
      if (!res.ok) {
        log.warn({ status: res.status }, "org service returned a non-success status");
        throw new OrgServiceError("unavailable", `org service ${res.status}`);
      }
      type Raw = { data?: Array<{ id?: unknown; name?: unknown; code?: unknown }> };
      let json: Raw = {};
      try { json = (await res.json()) as Raw; } catch { json = {}; }
      const rows: Department[] = [];
      for (const r of json.data ?? []) {
        if (typeof r.id === "string" && typeof r.name === "string") rows.push({ id: r.id, name: r.name, code: typeof r.code === "string" ? r.code : "" });
      }
      cache.set(ctx.tenantId, { at: Date.now(), rows });
      return rows;
    },
  };
}

let current: OrgClient | null = null;
export function getOrgClient(): OrgClient { current ??= createHttpOrgClient(); return current; }
/** Test seam. */
export function setOrgClient(c: OrgClient | null): void { current = c; }

/** id -> name map for display enrichment; fail-OPEN to an empty map (a missing name must not break a page). */
export async function departmentNames(ctx: OrgCallCtx): Promise<Map<string, string>> {
  try {
    return new Map((await getOrgClient().listDepartments(ctx)).map((d) => [d.id, d.name]));
  } catch {
    return new Map();
  }
}
