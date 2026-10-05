/** document_scanner role discipline: read-only grants, scanner pool used only for cross-tenant discovery. */
import { describe, it, expect, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";

afterAll(async () => { await sqlClient.end(); });
const SRC = new URL("../src/", import.meta.url).pathname;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
}

describe("document_scanner privileges (catalog)", () => {
  it("is BYPASSRLS, not superuser; SELECT on bulk_scan.batch_files ONLY; no INSERT/UPDATE/DELETE anywhere", async () => {
    const role = (await db.execute(sql`SELECT rolsuper, rolbypassrls, rolcanlogin, rolcreaterole FROM pg_roles WHERE rolname = 'document_scanner'`)) as unknown as Record<string, boolean>[];
    expect(role[0]).toEqual({ rolsuper: false, rolbypassrls: true, rolcanlogin: true, rolcreaterole: false });
    const tables = (await db.execute(sql`
      SELECT n.nspname AS s, c.relname AS t,
        has_table_privilege('document_scanner', c.oid, 'SELECT') AS sel,
        has_table_privilege('document_scanner', c.oid, 'INSERT') AS ins,
        has_table_privilege('document_scanner', c.oid, 'UPDATE') AS upd,
        has_table_privilege('document_scanner', c.oid, 'DELETE') AS del,
        has_table_privilege('document_scanner', c.oid, 'TRUNCATE') AS trunc,
        has_table_privilege('document_scanner', c.oid, 'REFERENCES') AS ref
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p', 'v', 'm') AND n.nspname IN ('bulk_scan', 'document', '_outbox', '_inbox')`)) as unknown as
      { s: string; t: string; sel: boolean; ins: boolean; upd: boolean; del: boolean; trunc: boolean; ref: boolean }[];
    expect(tables.length).toBeGreaterThan(10);
    for (const r of tables) {
      expect([r.ins, r.upd, r.del, r.trunc, r.ref], `${r.s}.${r.t} write privileges`).toEqual([false, false, false, false, false]);
    }
    expect(tables.filter((r) => r.sel).map((r) => `${r.s}.${r.t}`)).toEqual(["bulk_scan.batch_files"]);
  });

  it("has no column-level or default privileges that would widen access", async () => {
    const cols = (await db.execute(sql`
      SELECT count(*)::int AS n FROM information_schema.columns c
      WHERE c.table_schema IN ('bulk_scan', 'document', '_outbox', '_inbox')
        AND (has_column_privilege('document_scanner', format('%I.%I', c.table_schema, c.table_name), c.column_name, 'INSERT')
          OR has_column_privilege('document_scanner', format('%I.%I', c.table_schema, c.table_name), c.column_name, 'UPDATE'))`)) as unknown as { n: number }[];
    expect(cols[0]?.n).toBe(0);
    const defs = (await db.execute(sql`SELECT count(*)::int AS n FROM pg_default_acl a JOIN pg_roles r ON a.defaclacl::text LIKE '%document_scanner=%' AND r.oid = a.defaclrole`)) as unknown as { n: number }[];
    expect(defs[0]?.n).toBe(0);
  });
});

describe("scanner pool is used ONLY for cross-tenant discovery (static)", () => {
  const files = walk(SRC);
  const rel = (f: string): string => f.slice(SRC.length);

  it("scanner-db is imported only by worker.ts (which hands it to scannerDiscovery)", () => {
    const importers = files.filter((f) => /from\s+["'][^"']*scanner-db(\.js)?["']/.test(readFileSync(f, "utf8"))).map(rel);
    expect(importers).toEqual(["worker.ts"]);
    const w = readFileSync(join(SRC, "worker.ts"), "utf8");
    expect(w).toMatch(/scannerDiscovery\(scannerDb\)/);
    expect(w).toMatch(/scannerRetentionDiscovery\(scannerDb\)/);   // retention discovery (read-only) also goes through a discovery adapter
    expect(w.match(/scannerDb/g)?.length).toBe(3);                    // import + the two discovery-adapter calls, nothing else
  });

  it("no pipeline / consumer / route / dispatcher code references the scanner pool or role", () => {
    for (const f of files.filter((x) => x.includes("modules/bulk-scan/"))) {
      expect(readFileSync(f, "utf8"), rel(f)).not.toMatch(/scannerDb|scannerSqlClient|scanner-db|document_scanner/);
    }
  });

  it("discovery reads are the ONLY repo functions taking a bare read handle, and they only select", () => {
    const repoSrc = readFileSync(join(SRC, "modules/bulk-scan/repo.ts"), "utf8");
    const readerFns = [...repoSrc.matchAll(/export async function (\w+)\(rdb: Reader/g)].map((m) => m[1]);
    expect(readerFns.sort()).toEqual(["discoverDueTenants", "discoverExpiredLeases", "discoverStalePendingUploads", "dueFilesForTenant"]);
    const body = repoSrc.slice(repoSrc.indexOf("cross-tenant discovery for the dispatcher"));
    expect(body).not.toMatch(/\.(insert|update|delete)\(/);
    expect(repoSrc).toMatch(/type Reader = Pick<typeof db, "select" \| "selectDistinct">/);          // no write methods on the type
  });

  it("every claim, transition and sweep write runs under the tenant GUC (runWithTenant)", () => {
    const d = readFileSync(join(SRC, "modules/bulk-scan/dispatcher.ts"), "utf8");
    expect(d).toMatch(/runWithTenant\(t, \(\) => claimForTenant\(/);
    expect(d).toMatch(/await runWithTenant\(e\.tenantId, async \(\) => \{[\s\S]*?db\.transaction/);
    // the discovery port is only called for reads
    expect(d).toMatch(/opts\.discovery\.(dueTenants|dueFiles|expiredLeases)/);
    const lease = readFileSync(join(SRC, "modules/bulk-scan/lease.ts"), "utf8");
    expect(lease.match(/runWithTenant\(tenantId/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
