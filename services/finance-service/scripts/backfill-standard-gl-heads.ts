/**
 * F89/F91 (UAT T6-01, T6-03): backfill the STANDARD GL heads (src/modules/gl/standard-heads.ts) into existing tenants'
 * charts of accounts. New tenants get them at provisioning (tenant-onboard consumer); tenants created before that, such
 * as UAT tenant A, lack 1250/5100/5101 (depreciation, disposal), 1300/4010 (billing), 5200 (refund) and more, so every
 * such journal is refused.
 *
 * Adds ONLY the codes a tenant is missing (INSERT ... ON CONFLICT (tenant_id, code) DO NOTHING). An existing head is
 * never updated, renamed or reclassified. Idempotent: a second run inserts nothing.
 *
 * Usage (from services/finance-service; DATABASE_URL must be able to read every tenant's heads, i.e. the owner/admin
 * role -- under the NOBYPASSRLS app role tenant discovery sees nothing, so pass --tenant explicitly):
 *   DATABASE_URL=... pnpm exec tsx scripts/backfill-standard-gl-heads.ts --dry-run
 *   DATABASE_URL=... pnpm exec tsx scripts/backfill-standard-gl-heads.ts [--tenant <uuid> ...] [--fill-missing-hoa]
 * --fill-missing-hoa (opt-in): also set the standard HoA on an EXISTING standard head whose hoa_code is NULL (bills
 * raised against it fail the HoA check otherwise). Nothing else about an existing head is ever changed.
 * Without --tenant, every tenant that already has a chart (any row in budget.finance_heads) is backfilled.
 */
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { missingStandardHeads, standardGlHeads, SEED_ACTOR, type StandardGlHead } from "../src/modules/gl/standard-heads.js";

type Sql = ReturnType<typeof postgres>;
export type TenantPlan = {
  tenantId: string; missing: StandardGlHead[]; inserted: string[];
  /** --fill-missing-hoa: existing standard heads whose hoa_code is NULL and gets the standard HoA (planned / done). */
  hoaFill: string[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function backfillStandardGlHeads(
  sql: Sql, opts: { dryRun: boolean; tenants?: string[]; fillMissingHoa?: boolean },
): Promise<TenantPlan[]> {
  const tenants = opts.tenants && opts.tenants.length > 0
    ? opts.tenants
    : (await sql<{ tenant_id: string }[]>`SELECT DISTINCT tenant_id::text AS tenant_id FROM budget.finance_heads ORDER BY 1`).map((r) => r.tenant_id);
  const plans: TenantPlan[] = [];
  for (const tenantId of tenants) {
    if (!UUID_RE.test(tenantId)) throw new Error(`not a tenant uuid: ${tenantId}`);
    const plan = await sql.begin(async (tx) => {
      // Transaction-scoped tenant GUC (RLS), never a session SET (pgbouncer transaction pooling).
      await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      const existing = await tx<{ code: string; hoa_code: string | null }[]>`SELECT code, hoa_code FROM budget.finance_heads WHERE tenant_id = ${tenantId}::uuid`;
      const missing = missingStandardHeads(existing.map((r) => r.code));
      const inserted: string[] = [];
      if (!opts.dryRun) {
        for (const h of missing) {
          const rows = await tx<{ code: string }[]>`
            INSERT INTO budget.finance_heads (id, tenant_id, code, name, level, classification, hoa_code, is_control, created_by, updated_by)
            VALUES (${randomUUID()}::uuid, ${tenantId}::uuid, ${h.code}, ${h.name}, 0, ${h.classification}, ${h.hoaCode ?? null},
                    ${h.isControl ?? false}, ${SEED_ACTOR}::uuid, ${SEED_ACTOR}::uuid)
            ON CONFLICT (tenant_id, code) DO NOTHING
            RETURNING code`;
          if (rows[0]) inserted.push(rows[0].code);
        }
      }
      // Opt-in, and the ONE exception to "never change an existing head": an existing standard head with NO HoA (e.g.
      // UAT tenant B's 2202, so every bill raised against it fails the HoA check) gets the standard HoA. Only a NULL is
      // filled; a head that has any HoA keeps it.
      const hoaFill: string[] = [];
      if (opts.fillMissingHoa) {
        const have = new Map(existing.map((r) => [r.code, r.hoa_code]));
        for (const h of standardGlHeads()) {
          if (!h.hoaCode || !have.has(h.code) || have.get(h.code) !== null) continue;
          if (opts.dryRun) { hoaFill.push(h.code); continue; }
          const rows = await tx<{ code: string }[]>`
            UPDATE budget.finance_heads SET hoa_code = ${h.hoaCode}, updated_by = ${SEED_ACTOR}::uuid, updated_at = now()
            WHERE tenant_id = ${tenantId}::uuid AND code = ${h.code} AND hoa_code IS NULL
            RETURNING code`;
          if (rows[0]) hoaFill.push(rows[0].code);
        }
      }
      return { tenantId, missing, inserted, hoaFill };
    });
    plans.push(plan as TenantPlan);
  }
  return plans;
}

function parseArgs(argv: string[]): { dryRun: boolean; tenants: string[]; fillMissingHoa: boolean } {
  const tenants: string[] = [];
  let dryRun = false;
  let fillMissingHoa = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--dry-run") dryRun = true;
    else if (a === "--tenant") tenants.push(argv[++i] ?? "");
    else if (a === "--fill-missing-hoa") fillMissingHoa = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return { dryRun, tenants, fillMissingHoa };
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const args = parseArgs(process.argv.slice(2));
  const sql = postgres(url, { max: 1 });
  try {
    const plans = await backfillStandardGlHeads(sql, args);
    let total = 0;
    for (const p of plans) {
      const codes = p.missing.map((h) => h.code).join(",") || "-";
      total += args.dryRun ? p.missing.length : p.inserted.length;
      console.log(`${args.dryRun ? "[dry-run] would add" : "added"} ${args.dryRun ? p.missing.length : p.inserted.length} head(s) for tenant ${p.tenantId}: ${args.dryRun ? codes : p.inserted.join(",") || "-"}`);
      if (p.hoaFill.length > 0) console.log(`${args.dryRun ? "[dry-run] would set" : "set"} the standard HoA on existing head(s) with none for tenant ${p.tenantId}: ${p.hoaFill.join(",")}`);
    }
    console.log(`${args.dryRun ? "[dry-run] " : ""}tenants: ${plans.length}, heads ${args.dryRun ? "to add" : "added"}: ${total}`);
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
