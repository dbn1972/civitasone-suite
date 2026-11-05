/**
 * POLICY-SEED-1 (UAT bundle 17): backfill the STANDARD roles and approve grants (src/modules/roles/standard-grants.ts)
 * into EXISTING tenants. New tenants get them from the tenant.tenant.created consumer; tenants created before it
 * (every tenant but the two the old seed hard-coded) lack some or all -- including procurement.plan.approve and
 * procurement.po_amendment.approve, which the old seed listed but never applied to any tenant (POLICY-SEED-2).
 *
 * Per tenant, under runWithTenant(<tenant>) (roles.* are FORCE RLS): creates only the missing roles / grants. An
 * existing role is never changed; an existing grant is skipped whatever its effect (a tenant deny stays a deny).
 * Idempotent: a second --apply creates nothing.
 *
 *   --dry-run (DEFAULT): report what would be created; writes nothing.
 *   --apply            : create the missing roles / grants.
 *   --tenant <uuid>    : only these tenants (repeatable). Without it, every tenant tenant-service lists
 *                        (GET /v1/tenants over the internal seam: TENANT_SERVICE_URL, INTERNAL_SERVICE_SECRET).
 *
 * Usage (from services/policy-service, with the policy-service runtime env -- DATABASE_URL as the app role):
 *   pnpm exec tsx scripts/backfill-standard-grants.ts                 # dry run, all tenants
 *   pnpm exec tsx scripts/backfill-standard-grants.ts --apply --tenant <uuid>
 * Prints one JSON report line.
 */
import { pathToFileURL } from "node:url";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { provisionStandardGrantsForTenant, type StandardProvisionResult } from "../src/modules/roles/standard-provision.js";

export const BACKFILL_ACTOR = "00000000-0000-0000-0000-000000000000";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ListTenantIds = () => Promise<string[]>;
export type TenantReport = { tenantId: string } & StandardProvisionResult;
export interface BackfillReport { dryRun: boolean; tenants: TenantReport[]; rolesToCreate: number; grantsToCreate: number; skipped: string[] }

type FetchLike = (input: string, init: { method: string; headers: Record<string, string>; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

/** Every tenant id tenant-service knows (paged GET /v1/tenants, internal service seam). */
export function makeTenantIdLister(opts: { baseUrl?: string; secret?: string; fetchFn?: FetchLike; pageSize?: number } = {}): ListTenantIds {
  const baseUrl = (opts.baseUrl ?? process.env.TENANT_SERVICE_URL ?? "http://127.0.0.1:3002").replace(/\/$/, "");
  const secret = opts.secret ?? process.env.INTERNAL_SERVICE_SECRET ?? "";
  const fetchFn: FetchLike = opts.fetchFn ?? (globalThis.fetch as unknown as FetchLike);
  const pageSize = opts.pageSize ?? 500;
  return async () => {
    const ids: string[] = [];
    for (let offset = 0; ; offset += pageSize) {
      const res = await fetchFn(`${baseUrl}/v1/tenants?limit=${pageSize}&offset=${offset}`, {
        method: "GET",
        headers: { "x-internal": "1", "x-service-secret": secret, "x-tenant-id": BACKFILL_ACTOR, "x-correlation-id": `policy-grant-backfill-${offset}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`tenant-service GET /v1/tenants failed: HTTP ${res.status}`);
      const body = JSON.parse(await res.text()) as { data?: unknown };
      const page = Array.isArray(body.data) ? (body.data as Array<{ id?: unknown }>) : [];
      for (const t of page) if (typeof t.id === "string") ids.push(t.id);
      if (page.length < pageSize) break;
    }
    return ids;
  };
}

export async function backfillStandardGrants(opts: { dryRun: boolean; tenants?: string[]; listTenantIds?: ListTenantIds }): Promise<BackfillReport> {
  const ids = opts.tenants && opts.tenants.length > 0 ? opts.tenants : await (opts.listTenantIds ?? makeTenantIdLister())();
  const report: BackfillReport = { dryRun: opts.dryRun, tenants: [], rolesToCreate: 0, grantsToCreate: 0, skipped: [] };
  for (const tenantId of [...new Set(ids)]) {
    if (!UUID_RE.test(tenantId)) { report.skipped.push(tenantId); continue; }
    const r = await runWithTenant(tenantId, () => db.transaction((tx) =>
      provisionStandardGrantsForTenant(tx, tenantId, BACKFILL_ACTOR, { dryRun: opts.dryRun })));
    report.tenants.push({ tenantId, ...r });
    report.rolesToCreate += r.rolesCreated.length;
    report.grantsToCreate += r.grantsCreated.length;
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
    console.log(JSON.stringify(await backfillStandardGrants(args)));
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
