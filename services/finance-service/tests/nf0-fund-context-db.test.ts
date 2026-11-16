/**
 * Section 8 NF-0, real Postgres (run by the orchestrator, not the author):
 *  - migration 0170: gl.finance_settings.fund_accounting exists, is a nullable boolean, DEFAULT false, existing rows read false;
 *  - fundContext() resolves OFF for no row / NULL / false and ON only for true, and tag*() is the identity either way;
 *  - posting an identical journal for a tenant with fund_accounting OFF and one with it ON writes identical journal /
 *    journal-line / ledger rows (NF-0 tags nothing), so the seam is behaviour-neutral on the real posting path.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { MemoryQueue, type Handler } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import postgres from "postgres";
import { sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { fundContext, fundContextFromFlag } from "../src/modules/gl/fund-context.js";
import { COMMANDS } from "../src/topics.js";
import { backfillStandardGlHeads } from "../scripts/backfill-standard-gl-heads.js";
import { purgeLedgerRows } from "./_purge-ledger.js";

const ACTOR = "00000000-cccc-4000-8000-00000000f001";
const OFF_T = randomUUID(), ON_T = randomUUID(), NOROW_T = randomUUID(), NULL_T = randomUUID();
afterAll(async () => {
  for (const t of [OFF_T, ON_T]) await purgeLedgerRows(t, sql`true`);
  await sqlClient.end();
});

const rowsOf = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? r : (r as { rows: Record<string, unknown>[] }).rows);
const setFlag = (t: string, v: boolean | null) => scoped(t, (tx) => tx.execute(sql`
  INSERT INTO gl.finance_settings (tenant_id, accounting_basis, updated_by, fund_accounting)
  VALUES (${t}::uuid, 'accrual', ${ACTOR}::uuid, ${v}) ON CONFLICT (tenant_id) DO UPDATE SET fund_accounting = EXCLUDED.fund_accounting`));

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue({ maxAttempts: 1 });
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) =>
    raw(topic, (msg: Parameters<Handler>[0]) => runWithTenant(msg.tenantId, () => handler(msg)))) as typeof q.subscribe;
  return q;
}

describe("migration 0170: gl.finance_settings.fund_accounting", () => {
  it("is a nullable boolean with DEFAULT false", async () => {
    const r = rowsOf(await sqlClient`SELECT data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = 'gl' AND table_name = 'finance_settings' AND column_name = 'fund_accounting'`);
    expect(r[0]).toMatchObject({ data_type: "boolean", is_nullable: "YES" });
    expect(String(r[0]?.column_default)).toMatch(/false/);
  });
  it("a settings row inserted without the column reads false", async () => {
    await scoped(NOROW_T, (tx) => tx.execute(sql`INSERT INTO gl.finance_settings (tenant_id, updated_by) VALUES (${NOROW_T}::uuid, ${ACTOR}::uuid)`));
    const r = rowsOf(await scoped(NOROW_T, (tx) => tx.execute(sql`SELECT fund_accounting FROM gl.finance_settings WHERE tenant_id = ${NOROW_T}::uuid`)));
    expect(r[0]?.fund_accounting).toBe(false);
  });
});

describe("fundContext()", () => {
  it("no row / NULL / false => disabled; true => enabled; tag*() is the identity", async () => {
    const MISSING = randomUUID();
    await setFlag(NULL_T, null);
    await setFlag(OFF_T, false);
    await setFlag(ON_T, true);
    const row = { a: 1 };
    for (const [t, want] of [[MISSING, false], [NULL_T, false], [OFF_T, false], [ON_T, true]] as const) {
      const ctx = await scoped(t, (tx) => fundContext(tx, t));
      expect(ctx.enabled, t).toBe(want);
      expect(ctx.tagJournal(row)).toBe(row);
      expect(ctx.tagJournalLine(row)).toBe(row);
      expect(ctx.tagLedgerLine(row)).toBe(row);
    }
    expect(fundContextFromFlag(undefined).enabled).toBe(false);
  });
});

describe("posting through the seam is identical with fund_accounting OFF and ON", () => {
  async function postDisposal(tenant: string, assetId: string) {
    const pg = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });
    try { await backfillStandardGlHeads(pg, { dryRun: false, tenants: [tenant] }); } finally { await pg.end({ timeout: 5 }); }
    const q = tenantWrappedQueue();
    registerGlConsumers(q);
    await q.start();
    await q.publish(COMMANDS.journalPost, {
      messageId: randomUUID(), type: COMMANDS.journalPost, tenantId: tenant, actorId: ACTOR, correlationId: "corr-nf0", schemaVersion: "1.0",
      payload: { type: "asset_disposal", assetId, acquisitionCost: "1000000", accumulatedDep: "400000", proceeds: "80000", disposalDate: "2027-09-01" },
    });
    await q.drain();
    await q.stop();
    expect(q.dlq.length).toBe(0);
  }
  const shape = async (tenant: string) => ({
    journals: rowsOf(await scoped(tenant, (tx) => tx.execute(sql`SELECT type, posting_date::text AS posting_date, status, lines FROM gl.finance_journals WHERE tenant_id = ${tenant}::uuid ORDER BY voucher_no`))),
    journalLines: rowsOf(await scoped(tenant, (tx) => tx.execute(sql`SELECT head_code, debit_minor::text AS d, credit_minor::text AS c, journal_type FROM gl.finance_journal_lines WHERE tenant_id = ${tenant}::uuid ORDER BY head_code, debit_minor, credit_minor`))),
    ledger: rowsOf(await scoped(tenant, (tx) => tx.execute(sql`SELECT fh.code, fl.debit_minor::text AS d, fl.credit_minor::text AS c, fl.balance_minor::text AS b, fl.posting_date::text AS pd FROM gl.finance_ledger fl JOIN budget.finance_heads fh ON fh.id = fl.head_id AND fh.tenant_id = fl.tenant_id WHERE fl.tenant_id = ${tenant}::uuid ORDER BY fh.code, fl.debit_minor, fl.credit_minor`))),
  });

  it("an asset disposal writes the same journal, journal lines and ledger rows for both tenants", async () => {
    await setFlag(OFF_T, false);
    await setFlag(ON_T, true);
    await postDisposal(OFF_T, randomUUID());
    await postDisposal(ON_T, randomUUID());
    const off = await shape(OFF_T);
    const on = await shape(ON_T);
    expect(off.ledger.length).toBeGreaterThan(0);
    expect(on).toEqual(off);
  });
});
