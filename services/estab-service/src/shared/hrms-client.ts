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
type EmployeeSummary = { id: string; fullName: string; departmentName: string; userRef?: string | null };

/**
 * Best-effort, tenant-scoped id → display-name/department map. Never throws:
 * an empty map (falling back to id truncation at the call site) is always a
 * safe degradation — display enrichment must never break a file/noting read.
 */
export async function getEmployeeDisplayMap(tenantId: string, ids?: readonly string[]): Promise<Map<string, EmployeeDisplay>> {
  // SF-17b: callers that know which ids they are about to render pass them, so
  // the lookup is exact (batched, tenant-scoped on the hrms side) instead of
  // depending on the 2000-row unfiltered feed, which silently drops anyone
  // beyond the cap on a larger tenant.
  if (ids) return getEmployeeDisplayMapByIds(tenantId, ids);
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

const IDS_PER_REQUEST = 40;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Exactly the given ids, in bounded parallel chunks. An id may be an hrms
 * employee id OR an identity-provider actor id (estab stores both: officers
 * routed to are employee ids, authors/creators are actor ids), so each chunk is
 * asked both ways and both keys are mapped to the same display. Never throws; an
 * unresolvable id has no entry (callers show "Unknown employee").
 */
export async function getEmployeeDisplayMapByIds(tenantId: string, ids: readonly string[]): Promise<Map<string, EmployeeDisplay>> {
  const unique = [...new Set(ids.filter((i) => typeof i === "string" && UUID_RE.test(i)))];
  const map = new Map<string, EmployeeDisplay>();
  for (let i = 0; i < unique.length; i += IDS_PER_REQUEST * 8) {
    const wave: string[][] = [];
    for (let j = i; j < Math.min(unique.length, i + IDS_PER_REQUEST * 8); j += IDS_PER_REQUEST) wave.push(unique.slice(j, j + IDS_PER_REQUEST));
    const parts = await Promise.all(wave.flatMap((chunk) => [
      fetchEmployeeSummaries(tenantId, { ids: chunk }),
      fetchEmployeeSummaries(tenantId, { actorIds: chunk }),
    ]));
    for (const rows of parts) {
      for (const e of rows) {
        const d = { fullName: e.fullName, departmentName: e.departmentName };
        map.set(e.id, d);
        if (e.userRef) map.set(e.userRef, d);
      }
    }
  }
  return map;
}

async function fetchEmployeeSummaries(tenantId: string, filter?: { ids?: readonly string[]; actorIds?: readonly string[] }): Promise<EmployeeSummary[]> {
  const serviceSecret = process.env.INTERNAL_SERVICE_SECRET;
  if (!serviceSecret) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${HRMS_URL}/v1/hrms/internal/employee-summaries${filter?.ids ? `?ids=${filter.ids.map(encodeURIComponent).join(",")}` : filter?.actorIds ? `?actorIds=${filter.actorIds.map(encodeURIComponent).join(",")}` : ""}`, {
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

export class HrmsUnavailableError extends Error {
  readonly code = "HRMS_UNAVAILABLE";
  constructor(message: string) {
    super(message);
    this.name = "HrmsUnavailableError";
  }
}

/**
 * Resolve the CALLER's own hrms employee id (actorId is the JWT subject, a different id space).
 * Used to derive the initiating officer of an eFile from the session so a clerk can never raise
 * a file in another officer's name (GAP-GRANTS-DISBURSEMENTS-DETAIL-03). `null` = the actor has
 * no linked employee record. Fails CLOSED (throws HrmsUnavailableError) when HRMS cannot answer:
 * this gates attribution, so "can't tell" is never treated as "allow".
 */
export async function resolveActorEmployeeId(tenantId: string, actorId: string): Promise<string | null> {
  const serviceSecret = process.env.INTERNAL_SERVICE_SECRET;
  if (!serviceSecret) throw new HrmsUnavailableError("internal service secret not configured");
  const url = `${HRMS_URL}/v1/hrms/internal/employees/actor/${encodeURIComponent(actorId)}/resolve`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "x-internal": "1", "x-service-secret": serviceSecret, "x-tenant-id": tenantId },
      signal: AbortSignal.timeout(4000),
    });
  } catch (err) {
    throw new HrmsUnavailableError(`hrms actor-employee resolve unreachable: ${(err as Error).message}`);
  }
  if (!res.ok) throw new HrmsUnavailableError(`hrms actor-employee resolve failed: ${res.status}`);
  const body = (await res.json()) as { employeeId?: string | null };
  return body.employeeId ?? null;
}

/** Point existence check for an hrms employee id (validates a "forward to" target). Fails closed. */
export async function verifyEmployeeExists(tenantId: string, employeeId: string): Promise<boolean> {
  const serviceSecret = process.env.INTERNAL_SERVICE_SECRET;
  if (!serviceSecret) throw new HrmsUnavailableError("internal service secret not configured");
  let res: Response;
  try {
    res = await fetch(`${HRMS_URL}/v1/hrms/internal/employees/${encodeURIComponent(employeeId)}/exists`, {
      headers: { "x-internal": "1", "x-service-secret": serviceSecret, "x-tenant-id": tenantId },
      signal: AbortSignal.timeout(4000),
    });
  } catch (err) {
    throw new HrmsUnavailableError(`hrms employee existence check unreachable: ${(err as Error).message}`);
  }
  if (!res.ok) throw new HrmsUnavailableError(`hrms employee existence check failed: ${res.status}`);
  return ((await res.json()) as { exists: boolean }).exists === true;
}
