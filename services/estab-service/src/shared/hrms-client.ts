/**
 * Internal HTTP client for estab-service → hrms-service employee display
 * enrichment.
 *
 * Background: estab-service's noting/custody/dispatch trail (modules/files)
 * records the officer of record as a UUID — either the authenticated actor
 * (ctx.actorId, forced server-side since PR #729 / commit 4f2ac4ac so a
 * client can never spoof it) or an explicitly-chosen colleague (an hrms
 * `employeeId`, picked from the operators directory — see modules/operators
 * and FileDetailActions.tsx's "refer to" dropdown, which submits
 * `o.employeeId`, not `o.id`). Neither of those is a display name.
 * `queries.ts`'s `officerLabel()` used to just truncate the UUID
 * (`id.slice(0, 8)`) unconditionally — never even attempting a real lookup.
 * This module does the real lookup, the same way payroll-service resolves
 * hrms employee ids for payslip display (see
 * services/payroll-service/src/shared/hrms-client.ts).
 *
 * Uses hrms-service's `/v1/hrms/internal/employee-summaries` endpoint — the
 * same one payroll-service uses. Its own code comment (in
 * services/hrms-service/src/modules/internal/routes.ts, right above the
 * `/employees/:id/exists` point-lookup added alongside it) documents
 * employee-summaries as the sanctioned "display enrichment, best-effort"
 * endpoint — as opposed to a security-relevant existence/authorization check,
 * which must use the point lookup instead. We only ever render a label here,
 * so employee-summaries is the correct endpoint, not `/exists`.
 *
 * IMPORTANT — this does not (and cannot yet) resolve every officer id:
 * `ctx.actorId` is the Keycloak *subject* of whoever is logged in; hrms
 * employee records are not keyed by, or linked anywhere to, a Keycloak user
 * id (no employee↔identity bridge exists in this platform today — confirmed
 * by grepping the whole monorepo for any keycloak/auth-user linkage column;
 * there is none). So a self-authored noting (the common case) will
 * legitimately still not resolve here and falls back to the truncated id,
 * exactly as before. What this fixes is the case that previously never even
 * attempted resolution: an id that genuinely IS a real hrms employeeId
 * (explicit routing/movement/dispatch to a named colleague) now shows their
 * real name instead of always showing 8 hex characters. The self-authored
 * gap is a separate, larger platform gap (no identity↔HR bridge at all) —
 * out of scope here; see the PR description.
 */
import { cache } from "./infra.js";

const HRMS_URL = process.env.HRMS_SERVICE_URL ?? "http://127.0.0.1:3012";
// Keep well under typical upstream request timeouts — this must never make a
// file/noting read hang because hrms-service is slow.
const FETCH_TIMEOUT_MS = 2000;
const CACHE_TTL_SECONDS = 30;

export type EmployeeDisplay = { fullName: string; departmentName: string };
type EmployeeSummary = { id: string; fullName: string; departmentName: string };

/**
 * Best-effort, tenant-scoped id → display-name/department map. Never throws:
 * an empty map (falling back to id truncation at the call site) is always a
 * safe degradation — display enrichment must never break a file/noting read.
 */
export async function getEmployeeDisplayMap(tenantId: string): Promise<Map<string, EmployeeDisplay>> {
  const rows = await cache.getOrLoad<EmployeeSummary[]>(
    cache.makeKey(tenantId, "hrms-employee-summaries", "v1"),
    () => fetchEmployeeSummaries(tenantId),
    CACHE_TTL_SECONDS,
  );
  const map = new Map<string, EmployeeDisplay>();
  for (const e of rows ?? []) {
    map.set(e.id, { fullName: e.fullName, departmentName: e.departmentName });
  }
  return map;
}

async function fetchEmployeeSummaries(tenantId: string): Promise<EmployeeSummary[]> {
  const serviceSecret = process.env.INTERNAL_SERVICE_SECRET;
  if (!serviceSecret) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${HRMS_URL}/v1/hrms/internal/employee-summaries`, {
      headers: {
        "x-internal": "1",
        "x-service-secret": serviceSecret,
        "x-tenant-id": tenantId,
      },
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const body = (await res.json()) as unknown;
    return Array.isArray(body) ? (body as EmployeeSummary[]) : [];
  } catch {
    // hrms-service unreachable/erroring/timed out: degrade to id truncation
    // at the call site, exactly like a genuinely-unknown employee id.
    return [];
  } finally {
    clearTimeout(timer);
  }
}
