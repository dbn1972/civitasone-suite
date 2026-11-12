/**
 * Post sign-off backfill for employee.hrms_employees (draft PR; see the PR body):
 *   1. SEAL the identifiers that are still plaintext at rest. Migration 0268 made uan_number an encryptedText column,
 *      but the rows written before it (UAT: 424, none sealed) stay plaintext until written. The other columns the G6 design
 *      names (pan, bank_account_no, bank_ifsc) are sealed already on UAT; they are in the default column list only so
 *      the same command proves it (and fixes any legacy straggler). Idempotent: a value that already has an "enc:" prefix
 *      is never re-encrypted.
 *   2. FILL the blind index (uan_bidx) for every row that has a UAN and no index, or an index under a key id that is
 *      no longer in the keyring when --reindex is given.
 *
 *   --dry-run (DEFAULT): counts only; writes nothing.
 *   --apply            : write.
 *   --tenant <uuid>    : only this tenant (repeatable); default every tenant.
 *   --columns a,b      : subset of uan_number,pan,bank_account_no,bank_ifsc (default: all four).
 *   --batch-size <n>   : rows per transaction, 1..2000 (default 200).
 *   --after <uuid>     : resume after this employee id (printed as `lastId` after every batch and in the report).
 *   --max-rows <n>     : stop after n rows have been touched in this run.
 *   --reindex          : also recompute uan_bidx where its key id differs from the active key id.
 *
 * Resumable by construction: the rows to do are selected by state (plaintext, or index missing), ordered by id, so a
 * killed run is continued by simply running it again (or with --after to skip the part already done). Each row is
 * updated with a compare-and-set on the value that was read, so a concurrent edit is never overwritten (counted as
 * `conflicts`, picked up by the next run). The update does not touch version / updated_at / updated_by: it changes
 * how the same data is stored, not the record.
 *
 * NEVER logs a value: output is counts, tenant ids and employee ids only. Needs the hrms-service runtime env
 * (DATABASE_URL, PII_ENC_KEY [+ PII_KEY_ID / PII_ENC_KEYRING / PII_ENC_SALT as deployed]). Point DATABASE_URL at the
 * database deliberately: there is no default.
 *
 * Usage (from services/hrms-service):
 *   pnpm exec tsx scripts/backfill-uan-encryption.ts --tenant <uuid>              # dry run
 *   pnpm exec tsx scripts/backfill-uan-encryption.ts --apply --tenant <uuid>
 */
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient, scopedPlatformRead } from "../src/shared/db.js";
import * as employeeRepo from "../src/modules/employee/repo.js";
import { decryptPii, encryptPii, isEncrypted } from "../src/shared/pii-crypto.js";
import { activeBlindIndexKeyId, blindIndexKeyId, uanBlindIndex } from "../src/shared/blind-index.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Column allow-list (these names are interpolated into SQL, so only ever these). */
export const SEALABLE_COLUMNS = ["uan_number", "pan", "bank_account_no", "bank_ifsc"] as const;
export type SealableColumn = (typeof SEALABLE_COLUMNS)[number];

export interface BackfillArgs {
  apply: boolean; tenants: string[]; columns: SealableColumn[]; batchSize: number;
  after: string | null; maxRows: number | null; reindex: boolean;
}
export interface TenantReport {
  tenantId: string; scanned: number; sealed: Record<string, number>; indexed: number; reindexed: number;
  conflicts: number; failed: number; lastId: string | null;
}
export interface BackfillReport { mode: "dry-run" | "apply"; tenants: TenantReport[]; totals: { scanned: number; sealed: number; indexed: number; reindexed: number; conflicts: number; failed: number } }

export function parseArgs(argv: string[]): BackfillArgs {
  const a: BackfillArgs = { apply: false, tenants: [], columns: [...SEALABLE_COLUMNS], batchSize: 200, after: null, maxRows: null, reindex: false };
  let dry = false;
  for (let i = 0; i < argv.length; i++) {
    const f = argv[i];
    if (f === "--apply") a.apply = true;
    else if (f === "--dry-run") dry = true;
    else if (f === "--reindex") a.reindex = true;
    else if (f === "--tenant") { const v = argv[++i]; if (!v || !UUID_RE.test(v)) throw new Error("--tenant needs a tenant uuid"); a.tenants.push(v); }
    else if (f === "--after") { const v = argv[++i]; if (!v || !UUID_RE.test(v)) throw new Error("--after needs an employee uuid"); a.after = v; }
    else if (f === "--batch-size") { const n = Number(argv[++i]); if (!Number.isInteger(n) || n < 1 || n > 2000) throw new Error("--batch-size must be an integer 1..2000"); a.batchSize = n; }
    else if (f === "--max-rows") { const n = Number(argv[++i]); if (!Number.isInteger(n) || n < 1) throw new Error("--max-rows must be a positive integer"); a.maxRows = n; }
    else if (f === "--columns") {
      const cols = (argv[++i] ?? "").split(",").map((c) => c.trim()).filter(Boolean);
      const bad = cols.filter((c) => !(SEALABLE_COLUMNS as readonly string[]).includes(c));
      if (cols.length === 0 || bad.length > 0) throw new Error(`--columns must be a subset of ${SEALABLE_COLUMNS.join(",")}`);
      a.columns = cols as SealableColumn[];
    } else throw new Error(`unknown argument: ${f}`);
  }
  if (a.apply && dry) throw new Error("--apply and --dry-run are mutually exclusive");
  if (a.after && a.tenants.length !== 1) throw new Error("--after needs exactly one --tenant (ids are per tenant)");
  return a;
}

type RawRow = Record<string, string | null> & { id: string; uan_bidx: string | null };

/** What a single row needs, without touching the database. Pure; unit tested. */
export function planRow(row: RawRow, cols: readonly SealableColumn[], activeKeyId: string, reindex: boolean): { seal: SealableColumn[]; needsIndex: boolean; reindexing: boolean } {
  const seal = cols.filter((c) => row[c] != null && row[c] !== "" && !isEncrypted(row[c]!));
  const hasUan = row["uan_number"] != null && row["uan_number"] !== "";
  const kid = blindIndexKeyId(row.uan_bidx);
  const missing = hasUan && row.uan_bidx == null;
  const stale = hasUan && row.uan_bidx != null && reindex && kid !== activeKeyId;
  return { seal, needsIndex: missing || stale, reindexing: stale };
}

async function selectBatch(tenantId: string, cols: readonly SealableColumn[], after: string | null, limit: number, reindex: boolean, activeKeyId: string): Promise<RawRow[]> {
  const plain = (c: string) => sql.raw(`(${c} IS NOT NULL AND ${c} <> '' AND ${c} NOT LIKE 'enc:v%')`);
  const sealConds = cols.map((c) => plain(c));
  const indexCond = sql`(uan_number IS NOT NULL AND uan_number <> '' AND (uan_bidx IS NULL${reindex ? sql` OR uan_bidx NOT LIKE ${activeKeyId + ".%"}` : sql``}))`;
  const any = sql.join([...sealConds, indexCond], sql` OR `);
  const colList = sql.raw(["id", ...SEALABLE_COLUMNS, "uan_bidx"].join(", "));
  return runWithTenant(tenantId, () => db.transaction(async (tx) => {
    const rows = await tx.execute(sql`
      SELECT ${colList} FROM employee.hrms_employees
       WHERE tenant_id = ${tenantId}::uuid AND (${any})
         ${after ? sql`AND id > ${after}::uuid` : sql``}
       ORDER BY id LIMIT ${limit}`);
    return rows as unknown as RawRow[];
  }));
}

async function applyRow(tenantId: string, row: RawRow, plan: ReturnType<typeof planRow>): Promise<"ok" | "conflict"> {
  const sets: ReturnType<typeof sql>[] = [];
  const guards: ReturnType<typeof sql>[] = [];
  for (const c of plan.seal) {
    sets.push(sql`${sql.raw(c)} = ${encryptPii(row[c]!)}`);
    guards.push(sql`${sql.raw(c)} = ${row[c]!}`);
  }
  if (plan.needsIndex) {
    const clear = row["uan_number"] != null && isEncrypted(row["uan_number"]) ? decryptPii(row["uan_number"]) : row["uan_number"];
    sets.push(sql`uan_bidx = ${uanBlindIndex(tenantId, clear)}`);
    if (row.uan_bidx == null) guards.push(sql`uan_bidx IS NULL`); else guards.push(sql`uan_bidx = ${row.uan_bidx}`);
    // If the UAN is sealed by this very update, the guard above already pins the plaintext we indexed.
  }
  if (sets.length === 0) return "ok";
  const res = await runWithTenant(tenantId, () => db.transaction(async (tx) =>
    tx.execute(sql`
      UPDATE employee.hrms_employees SET ${sql.join(sets, sql`, `)}
       WHERE id = ${row.id}::uuid AND tenant_id = ${tenantId}::uuid AND ${sql.join(guards, sql` AND `)}
       RETURNING id`)));
  return (res as unknown as unknown[]).length === 1 ? "ok" : "conflict";
}

export async function backfillUanEncryption(args: BackfillArgs): Promise<BackfillReport> {
  const activeKeyId = activeBlindIndexKeyId();
  const tenantIds = args.tenants.length > 0 ? args.tenants : await scopedPlatformRead((tx) => employeeRepo.listEmployeeTenantIds(tx));
  const out: TenantReport[] = [];
  let budget = args.maxRows;
  for (const tenantId of tenantIds) {
    const rep: TenantReport = { tenantId, scanned: 0, sealed: {}, indexed: 0, reindexed: 0, conflicts: 0, failed: 0, lastId: null };
    let cursor = args.after;
    // Dry run cannot advance by "state" (nothing changes), so it pages by id; apply pages by id too, which also
    // guarantees progress past a row that conflicts or fails.
    for (;;) {
      if (budget !== null && budget <= 0) break;
      const limit = budget !== null ? Math.min(args.batchSize, budget) : args.batchSize;
      const rows = await selectBatch(tenantId, args.columns, cursor, limit, args.reindex, activeKeyId);
      if (rows.length === 0) break;
      for (const row of rows) {
        rep.scanned++;
        if (budget !== null) budget--;
        const plan = planRow(row, args.columns, activeKeyId, args.reindex);
        let outcome: "ok" | "conflict" = "ok";
        if (args.apply) {
          try { outcome = await applyRow(tenantId, row, plan); } catch { rep.failed++; cursor = row.id; rep.lastId = row.id; continue; }
        }
        if (outcome === "conflict") rep.conflicts++;
        else {
          for (const c of plan.seal) rep.sealed[c] = (rep.sealed[c] ?? 0) + 1;
          if (plan.needsIndex) { if (plan.reindexing) rep.reindexed++; else rep.indexed++; }
        }
        cursor = row.id; rep.lastId = row.id;
      }
      if (args.apply) console.error(JSON.stringify({ progress: { tenantId, scanned: rep.scanned, lastId: rep.lastId } }));
    }
    out.push(rep);
  }
  const sum = (f: (t: TenantReport) => number) => out.reduce((n, t) => n + f(t), 0);
  return {
    mode: args.apply ? "apply" : "dry-run", tenants: out,
    totals: {
      scanned: sum((t) => t.scanned), sealed: sum((t) => Object.values(t.sealed).reduce((a, b) => a + b, 0)),
      indexed: sum((t) => t.indexed), reindexed: sum((t) => t.reindexed), conflicts: sum((t) => t.conflicts), failed: sum((t) => t.failed),
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  try {
    console.log(JSON.stringify(await backfillUanEncryption(args)));
  } finally {
    await sqlClient.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    // Error text only; row values never reach an exception message here.
    console.error(err instanceof Error ? err.message : "backfill failed");
    process.exit(1);
  });
}
