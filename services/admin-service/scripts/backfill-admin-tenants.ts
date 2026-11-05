/**
 * F133 (UAT bundle 17): backfill tenants that exist in tenant-service but not in the admin directory
 * (tenants.admin_tenants), e.g. 353c0e2c-... -- created before the bundle 15 tenant.tenant.created fix, so
 * /admin/tenants/<id> says "Tenant Not Found".
 *
 * Reads every tenant from tenant-service (GET /v1/tenants, paged, over the internal service seam:
 * x-internal + INTERNAL_SERVICE_SECRET), turns each into a directory row with the SAME rule as the live
 * consumer (resolveTenantCreated: edition govt -> govt_dept, nothing fabricated) and INSERTS only the rows
 * admin does not have, each under runWithTenant(<that tenant>) because admin_tenants is FORCE RLS.
 * An existing admin row is never changed. Idempotent: a second --apply inserts nothing.
 *
 *   --dry-run (DEFAULT): report what would be inserted / skipped; writes nothing.
 *   --apply            : insert the missing rows.
 *   --tenant <uuid>    : only these tenants (repeatable).
 *
 * Usage (from services/admin-service, with the admin-service runtime env: DATABASE_URL as the app role,
 * TENANT_SERVICE_URL, INTERNAL_SERVICE_SECRET):
 *   pnpm exec tsx scripts/backfill-admin-tenants.ts                 # dry run
 *   pnpm exec tsx scripts/backfill-admin-tenants.ts --apply
 * Prints one JSON report line; no PII beyond tenant id / name / domain (already directory data).
 */
import { pathToFileURL } from "node:url";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import * as repo from "../src/modules/tenants/repo.js";
import { resolveTenantCreated, type FetchedTenant, type TenantDirectoryRow } from "../src/modules/tenants/tenant-created.js";

/** The system actor stamped on backfilled rows (created_by / updated_by). */
export const BACKFILL_ACTOR = "00000000-0000-0000-0000-000000000000";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ListTenants = () => Promise<FetchedTenant[]>;
export interface BackfillReport {
  dryRun: boolean;
  checked: number;
  alreadyPresent: string[];
  /** dry run: would insert; --apply: inserted. */
  missing: Array<{ id: string; name: string; domain: string; edition: string }>;
  inserted: string[];
  skipped: Array<{ id: string; reason: string }>;
}

type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/**
 * Every tenant tenant-service knows, paged (limit 500). The internal caller needs a tenant context for
 * tenant-service request scoping / its audit row; `actorTenantId` (default: the platform zero tenant) is it.
 */
export function makeTenantServiceLister(opts: { baseUrl?: string; secret?: string; fetchFn?: FetchLike; actorTenantId?: string; pageSize?: number } = {}): ListTenants {
  const baseUrl = (opts.baseUrl ?? process.env.TENANT_SERVICE_URL ?? "http://127.0.0.1:3002").replace(/\/$/, "");
  const secret = opts.secret ?? process.env.INTERNAL_SERVICE_SECRET ?? "";
  const fetchFn: FetchLike = opts.fetchFn ?? (globalThis.fetch as unknown as FetchLike);
  const actorTenant = opts.actorTenantId ?? BACKFILL_ACTOR;
  const pageSize = opts.pageSize ?? 500;
  return async () => {
    const all: FetchedTenant[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const res = await fetchFn(`${baseUrl}/v1/tenants?limit=${pageSize}&offset=${offset}`, {
        method: "GET",
        headers: { "x-internal": "1", "x-service-secret": secret, "x-tenant-id": actorTenant, "x-correlation-id": `admin-tenant-backfill-${offset}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`tenant-service GET /v1/tenants failed: HTTP ${res.status}`);
      const body = JSON.parse(await res.text()) as { data?: unknown; total?: unknown };
      const page = Array.isArray(body.data) ? (body.data as FetchedTenant[]) : [];
      all.push(...page);
      const total = typeof body.total === "number" ? body.total : null;
      if (page.length < pageSize || (total != null && all.length >= total)) break;
    }
    return all;
  };
}

export async function backfillAdminTenants(opts: { listTenants: ListTenants; dryRun: boolean; tenants?: string[] }): Promise<BackfillReport> {
  const only = opts.tenants && opts.tenants.length > 0 ? new Set(opts.tenants.map((t) => t.toLowerCase())) : null;
  const report: BackfillReport = { dryRun: opts.dryRun, checked: 0, alreadyPresent: [], missing: [], inserted: [], skipped: [] };
  for (const t of await opts.listTenants()) {
    const id = typeof t.id === "string" ? t.id : "";
    if (only && !only.has(id.toLowerCase())) continue;
    report.checked++;
    let row: TenantDirectoryRow;
    try {
      // the listed record IS the owner record: nothing is fetched again, nothing is guessed
      row = await resolveTenantCreated({ ...t, id, tenantId: id } as Parameters<typeof resolveTenantCreated>[0], async () => null);
    } catch (err) {
      report.skipped.push({ id: id || "(no id)", reason: err instanceof Error ? err.message : String(err) });
      continue;
    }
    if (!UUID_RE.test(row.id)) { report.skipped.push({ id: row.id, reason: "tenant id is not a uuid" }); continue; }
    const outcome = await Promise.resolve(runWithTenant(row.id, () => db.transaction(async (tx) => {
      if (await repo.findByIdTx(tx, row.id)) return "present" as const;
      if (opts.dryRun) return "missing" as const;
      await repo.insert(tx, {
        id: row.id, tenantId: row.id, name: row.name, domain: row.domain, edition: row.edition,
        status: row.status, region: row.region, residency: row.residency, settings: {},
        createdBy: BACKFILL_ACTOR, updatedBy: BACKFILL_ACTOR, version: 1,
      });
      return "inserted" as const;
    }))).catch((err: unknown) => {
      const e = err as { code?: string; cause?: { code?: string } };
      if (e?.code === "23505" || e?.cause?.code === "23505") return "domain_taken" as const;
      throw err;
    });
    if (outcome === "present") { report.alreadyPresent.push(row.id); continue; }
    if (outcome === "domain_taken") { report.skipped.push({ id: row.id, reason: `domain ${row.domain} is already registered for another tenant` }); continue; }
    report.missing.push({ id: row.id, name: row.name, domain: row.domain, edition: row.edition });
    if (outcome === "inserted") report.inserted.push(row.id);
  }
  return report;
}

export function parseArgs(argv: string[]): { dryRun: boolean; tenants: string[] } {
  let apply = false; let dry = false;
  const tenants: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--apply") apply = true;
    else if (a === "--dry-run") dry = true;
    else if (a === "--tenant") {
      const v = argv[++i];
      if (!v || !UUID_RE.test(v)) throw new Error("--tenant needs a tenant uuid");
      tenants.push(v);
    } else throw new Error(`unknown argument ${a} (use --dry-run | --apply | --tenant <uuid>)`);
  }
  if (apply && dry) throw new Error("--apply and --dry-run are mutually exclusive");
  return { dryRun: !apply, tenants };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  try {
    const report = await backfillAdminTenants({ listTenants: makeTenantServiceLister(), ...args });
    console.log(JSON.stringify(report));
  } finally {
    await sqlClient.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
