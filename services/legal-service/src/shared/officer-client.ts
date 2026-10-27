/**
 * Officer-directory CLIENT (F4, owner decision 2026-10-27): the privileged-case officer picker searches the
 * HRMS employee directory over the platform's service-to-service auth (x-internal + x-tenant-id +
 * x-service-secret), the same boundary the org-hierarchy client uses.
 *
 * An assigned officer is identified by their LOGIN id (hrms_employees.user_ref), because the case-access check
 * compares it with the caller's actor id. Employees with no linked login cannot sign in, so they are never offered.
 * Callers never see the upstream message.
 */
import { pino } from "pino";
import { OrgServiceError } from "./org-client.js";

const log = pino({ name: "legal-officer-client" });

export interface Officer { id: string; name: string; employeeNo: string; department: string }
export interface OfficerCallCtx { tenantId: string; correlationId: string }
export interface OfficerClient {
  /** Name / employee-number search; at most 20 officers. */
  search(ctx: OfficerCallCtx, q: string): Promise<Officer[]>;
  /** The subset of the given login ids that belong to an employee of this tenant. */
  resolve(ctx: OfficerCallCtx, ids: string[]): Promise<Officer[]>;
}

export interface OfficerHttpOptions { baseUrl?: string; secret?: string; fetchImpl?: typeof fetch; timeoutMs?: number }

const MAX_RESULTS = 20;

export function createHttpOfficerClient(opts: OfficerHttpOptions = {}): OfficerClient {
  const base = (opts.baseUrl ?? process.env.HRMS_SERVICE_URL ?? "http://127.0.0.1:3012").replace(/\/$/, "");
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? Number(process.env.ORG_SERVICE_TIMEOUT_MS ?? 5000);

  async function call(ctx: OfficerCallCtx, query: string): Promise<Officer[]> {
    const secret = opts.secret ?? process.env.INTERNAL_SERVICE_SECRET ?? "";
    if (!secret) throw new OrgServiceError("not_configured", "INTERNAL_SERVICE_SECRET is not set");
    let res: Response;
    try {
      res = await doFetch(`${base}/v1/hrms/internal/employee-summaries?${query}`, {
        headers: {
          "x-internal": "1", "x-tenant-id": ctx.tenantId, "x-service-secret": secret,
          "x-internal-caller": "legal-service", "x-correlation-id": ctx.correlationId,
        },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "manual",
      });
    } catch (err) {
      log.error({ err: err instanceof Error ? err.message : String(err) }, "officer directory call failed");
      throw new OrgServiceError("unavailable", "officer directory unreachable");
    }
    if (!res.ok) {
      log.warn({ status: res.status }, "officer directory returned a non-success status");
      throw new OrgServiceError("unavailable", `officer directory ${res.status}`);
    }
    let json: unknown = [];
    try { json = await res.json(); } catch { json = []; }
    const out: Officer[] = [];
    for (const r of Array.isArray(json) ? json : []) {
      const row = r as { fullName?: unknown; employeeNo?: unknown; departmentName?: unknown; userRef?: unknown };
      if (typeof row.userRef !== "string" || typeof row.fullName !== "string") continue;
      out.push({
        id: row.userRef,
        name: row.fullName,
        employeeNo: typeof row.employeeNo === "string" ? row.employeeNo : "",
        department: typeof row.departmentName === "string" ? row.departmentName : "",
      });
      if (out.length >= MAX_RESULTS) break;
    }
    return out;
  }

  return {
    search: (ctx, q) => call(ctx, `q=${encodeURIComponent(q)}`),
    resolve: (ctx, ids) => call(ctx, `actorIds=${encodeURIComponent(ids.join(","))}`),
  };
}

let current: OfficerClient | null = null;
export function getOfficerClient(): OfficerClient { current ??= createHttpOfficerClient(); return current; }
/** Test seam. */
export function setOfficerClient(c: OfficerClient | null): void { current = c; }
