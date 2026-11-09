/**
 * B23b item 1: vendor bills for a new tenant were refused with HOA_UNKNOWN_MAJOR_HEAD because major head
 * 2217 (Urban Development) was not in the global budget.finance_major_heads master. Root cause: the master only
 * held migration 0010's 33 rows, and the tenant.tenant.onboarded top-up used account_type values
 * (receipt / capital / public_account) the account_type CHECK rejects, so its transaction always rolled back.
 *
 * Real DB, run as the service role (non-superuser, NOBYPASSRLS) like CI.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { STANDARD_MAJOR_HEADS } from "../src/modules/hoa/standard-major-heads.js";
import { assertValidHoAWithMaster } from "../src/modules/hoa/domain.js";
import { registerTenantOnboardConsumers } from "../src/modules/tenant-onboard/consumer.js";

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(here, "..", "migrations", "0164_lmmha_standard_major_heads.sql");

afterAll(async () => { await sqlClient.end(); });

describe("LMMHA standard major heads", () => {
  it("runs as a non-superuser role that does not bypass RLS", async () => {
    const r = (await db.execute(sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`)) as unknown as Array<{ rolsuper: boolean; rolbypassrls: boolean }>;
    expect(r[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it("every standard head satisfies the table's CHECK constraints (sector, account_type, 4-digit code)", () => {
    const sectors = ["General", "Social", "Economic", "GrantsInAid", "PublicDebt", "Tax", "NonTax"];
    const types = ["revenue_receipt", "capital_receipt", "revenue_expenditure", "capital_expenditure", "expenditure", "loan"];
    const codes = new Set<string>();
    for (const h of STANDARD_MAJOR_HEADS) {
      expect(h.code).toMatch(/^\d{4}$/);
      expect(sectors).toContain(h.sector);
      expect(types).toContain(h.accountType);
      expect(codes.has(h.code)).toBe(false);
      codes.add(h.code);
    }
  });

  it("covers the municipal and common 2xxx/3xxx/4xxx/5xxx heads", () => {
    const have = new Set(STANDARD_MAJOR_HEADS.map((h) => h.code));
    for (const c of ["2217", "4217", "2215", "4215", "2216", "2059", "4059", "3054", "5054", "3604", "2202", "2210", "2235", "2245", "2071"]) {
      expect(have.has(c), `major head ${c}`).toBe(true);
    }
    expect(STANDARD_MAJOR_HEADS.find((h) => h.code === "2217")?.description).toBe("Urban Development");
  });

  it("migration 0164 lists exactly the same heads as the TypeScript list (drift guard)", () => {
    const sqlText = readFileSync(MIGRATION, "utf8");
    const rows = [...sqlText.matchAll(/^\s*\('(\d{4})', '((?:[^']|'')*)', '(\w+)', '(\w+)'\)/gm)]
      .map((m) => ({ code: m[1], description: m[2]!.replace(/''/g, "'"), sector: m[3], accountType: m[4] }));
    expect(rows).toEqual(STANDARD_MAJOR_HEADS.map((h) => ({ ...h })));
  });

  it("the live master (after migrations) contains every standard head, so a bill on 2217 passes the HoA master check", async () => {
    const rows = (await db.execute(sql`SELECT code::text AS code FROM budget.finance_major_heads`)) as unknown as Array<{ code: string }>;
    const have = new Set(rows.map((r) => r.code));
    const missing = STANDARD_MAJOR_HEADS.filter((h) => !have.has(h.code)).map((h) => h.code);
    expect(missing).toEqual([]);
    // 2217-80-800-01 style municipal head, as an 18-digit code: major 2217, sub-major 80, minor 800, ...
    await expect(assertValidHoAWithMaster("221780800010100000")).resolves.toBeUndefined();
  });

  it("tenant.tenant.onboarded commits (no CHECK violation) and records the audit event", async () => {
    const tenantId = randomUUID();
    const q = new MemoryQueue();
    registerTenantOnboardConsumers(q);
    await q.start();
    const messageId = randomUUID();
    await runWithTenant(tenantId, async () => {
      await q.publish("tenant.tenant.onboarded", {
        messageId, type: "tenant.tenant.onboarded", tenantId, actorId: randomUUID(), correlationId: randomUUID(), schemaVersion: "1.0",
        payload: { tenantId, adminEmail: "commissioner@sundarpur.gov.in", adminName: "Rajendra Singh Shekhawat", edition: "govt_dept" },
      });
      await q.drain();
    });
    // markProcessed is in the same transaction as the seeding: a rolled-back seed leaves no processed marker.
    const done = (await scoped(tenantId, (tx) => tx.execute(sql`SELECT 1 FROM _inbox.processed WHERE message_id = ${messageId}`))) as unknown as unknown[];
    await q.stop();
    expect(done.length).toBe(1);
  });
});
