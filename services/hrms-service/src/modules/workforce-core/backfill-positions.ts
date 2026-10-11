/**
 * Workforce Core backfill — tenant.positions source reader (ST-M01-08).
 *
 * `tenant.positions` is owned by TENANT-SERVICE, a different service. House
 * rule 2 / CLAUDE.md §3 forbid cross-service SQL and cross-service FKs, so this
 * tool NEVER queries tenant-service's database. It reads the positions through
 * exactly one of two house-rule-compliant paths, chosen by the operator:
 *
 *   (a) HTTP — tenant-service `GET /v1/positions`, over the same internal
 *       boundary the gateway and the existing hrms→tenant edition read use
 *       (x-internal + x-service-secret + x-tenant-id; see
 *       src/shared/tenant-client.ts fetchTenantEdition). Fails CLOSED: any
 *       error / non-2xx / malformed body throws, so the backfill does not
 *       silently proceed with a partial position set.
 *
 *   (b) FILE — an operator-supplied JSON export of the same shape, for
 *       air-gapped / offline runs where tenant-service is not reachable. The
 *       file is `{ "data": [ { id, orgUnitId|org_unit_id, code, title, grade,
 *       status } ] }` or a bare array.
 *
 * The PR body labels which path a given run used (D-ST-23 Mode-B note: the only
 * working office import today writes tenant.org_units; positions are the office
 * dimension this backfill maps into workforce_core.post.office_id).
 */
import { readFile } from "node:fs/promises";
import type { TenantPosition } from "./backfill.js";

interface RawPosition {
  id?: unknown;
  orgUnitId?: unknown;
  org_unit_id?: unknown;
  code?: unknown;
  title?: unknown;
  grade?: unknown;
  status?: unknown;
}

function normalise(raw: RawPosition): TenantPosition | null {
  const id = typeof raw.id === "string" ? raw.id : null;
  const code = typeof raw.code === "string" ? raw.code : null;
  const title = typeof raw.title === "string" ? raw.title : null;
  if (!id || !code || !title) return null;
  const orgUnitRaw = raw.orgUnitId ?? raw.org_unit_id;
  return {
    id,
    orgUnitId: typeof orgUnitRaw === "string" ? orgUnitRaw : null,
    code,
    title,
    grade: typeof raw.grade === "string" ? raw.grade : null,
    status: typeof raw.status === "string" ? raw.status : "active",
  };
}

function extractArray(body: unknown): RawPosition[] {
  if (Array.isArray(body)) return body as RawPosition[];
  if (body && typeof body === "object" && Array.isArray((body as { data?: unknown }).data)) {
    return (body as { data: RawPosition[] }).data;
  }
  throw new Error("tenant.positions payload is neither an array nor { data: [...] }");
}

/** Read tenant.positions from an operator-supplied JSON export file. */
export async function readPositionsFromFile(path: string): Promise<TenantPosition[]> {
  const text = await readFile(path, "utf8");
  const body = JSON.parse(text) as unknown;
  return extractArray(body)
    .map(normalise)
    .filter((p): p is TenantPosition => p !== null);
}

/**
 * Read tenant.positions over tenant-service's HTTP API. Fails CLOSED. The
 * internal service secret is read from env at call time (never a literal).
 */
export async function fetchPositionsFromTenantService(
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<TenantPosition[]> {
  const base = env.TENANT_SERVICE_URL ?? "http://127.0.0.1:3002";
  const secret = env.INTERNAL_SERVICE_SECRET ?? "";
  const res = await fetch(`${base}/v1/positions`, {
    headers: {
      "x-internal": "1",
      "x-service-secret": secret,
      "x-tenant-id": tenantId,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`tenant-service GET /v1/positions failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as unknown;
  return extractArray(body)
    .map(normalise)
    .filter((p): p is TenantPosition => p !== null);
}
