/**
 * F89/F91 (UAT T6-01, T6-03), real Postgres (finance_svc, FORCE RLS):
 *  - a newly provisioned tenant gets the standard GL heads (tenant.tenant.onboarded);
 *  - scripts/backfill-standard-gl-heads.ts adds ONLY the missing heads to an existing tenant (--dry-run changes nothing,
 *    an existing head keeps its name and classification, a second run adds nothing);
 *  - with the heads in place a billing.invoice.paid event posts its journal end to end (revenue-billing consumer ->
 *    finance.gl.post -> GL consumer), which also needs migration 0156 (the journal type billing_cash_receipt was refused
 *    by the journal-type CHECKs on gl.finance_journals and gl.finance_journal_lines).
 * Each run uses fresh tenant ids: finance_svc (correctly) cannot delete journals or ledger rows.
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { runWithTenant } from "@civitasone/db";
import { relayOnce } from "@civitasone/outbox";
import { db, sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { serializeFinanceOutboxRelay } from "./support/finance-outbox-lock.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeJournals } from "../src/modules/gl/schema.js";
import { registerTenantOnboardConsumers } from "../src/modules/tenant-onboard/consumer.js";
import { registerRevenueBillingConsumers } from "../src/modules/revenue-billing/consumer.js";
import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { deterministicId } from "../src/modules/gl/spine.js";
import { standardGlHeads, BILL_HEAD_HOA } from "../src/modules/gl/standard-heads.js";
import { backfillStandardGlHeads } from "../scripts/backfill-standard-gl-heads.js";

const ACTOR = "00000000-aaaa-4000-8000-0000000b1089";
const STANDARD = standardGlHeads().map((h) => h.code).sort();
const pg = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });

serializeFinanceOutboxRelay(process.env.DATABASE_URL!);

afterAll(async () => {
  await pg.end({ timeout: 5 });
  await sqlClient.end();
});

/** Runs each handler under the message tenant GUC (as worker.ts does) and AWAITS it, so a handler error fails the test. */
class DirectQueue {
  private handlers = new Map<string, Array<(m: any) => Promise<void>>>();
  subscribe(topic: string, handler: (m: any) => Promise<void>): void {
    this.handlers.set(topic, [...(this.handlers.get(topic) ?? []), handler]);
  }
  async publish(topic: string, m: any): Promise<string> {
    const msg = { type: topic, schemaVersion: "1.0", ...m, messageId: m.messageId ?? randomUUID() };
    for (const h of this.handlers.get(topic) ?? []) await runWithTenant(msg.tenantId, () => h(msg));
    return msg.messageId;
  }
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}
const tenantWrappedQueue = () => new DirectQueue();
const tick = (ms = 300) => new Promise<void>((r) => setTimeout(r, ms));
async function relayToCompletion(q: DirectQueue, max = 200): Promise<void> {
  for (let i = 0; i < max; i++) {
    await tick();
    if ((await relayOnce(db as never, q as never, 200, "finance-service")) === 0) return;
  }
  throw new Error("outbox did not drain");
}
const headsOf = async (tenantId: string) =>
  (await scoped(tenantId, (tx) => tx.select().from(financeHeads).where(eq(financeHeads.tenantId, tenantId)))) as Array<typeof financeHeads.$inferSelect>;
const envelope = (topic: string, tenantId: string, payload: Record<string, unknown>) => ({
  messageId: randomUUID(), type: topic, tenantId, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload,
});

describe("standard GL heads at provisioning", () => {
  it("tenant.tenant.onboarded seeds every standard head for the new tenant", async () => {
    const tenant = randomUUID();
    const q = tenantWrappedQueue();
    registerTenantOnboardConsumers(q as never);
    await q.start();
    // The shared CGA major-head seed in the same handler is refused by finance_major_heads_account_type_check (a separate,
    // pre-existing defect: it inserts account types such as "receipt" / "capital" the CHECK does not allow). The GL heads
    // are seeded in their own transaction, so a new tenant gets them regardless.
    await q.publish("tenant.tenant.onboarded", envelope("tenant.tenant.onboarded", tenant, { tenantId: tenant, adminEmail: "a@gov.in", adminName: "A", edition: "govt_dept" }))
      .catch((e: unknown) => { if (!/finance_major_heads_account_type_check/.test(String(e))) throw e; });
    await tick();
    await q.stop();
    expect((await headsOf(tenant)).map((h) => h.code).sort()).toEqual(STANDARD);
  });
});

describe("backfill-standard-gl-heads", () => {
  it("--dry-run reports the missing heads and changes nothing; the real run adds only those; a re-run adds none", async () => {
    const tenant = randomUUID();
    // an existing tenant like UAT tenant A: it has a bank head of its own (different name) and nothing else
    await scoped(tenant, (tx) => tx.insert(financeHeads).values({
      tenantId: tenant, code: "1100", name: "SBI Treasury Account", level: 1, classification: "asset", createdBy: ACTOR, updatedBy: ACTOR,
    }));

    const dry = await backfillStandardGlHeads(pg, { dryRun: true, tenants: [tenant] });
    expect(dry[0]!.missing.map((h) => h.code).sort()).toEqual(STANDARD.filter((c) => c !== "1100"));
    expect(dry[0]!.inserted).toEqual([]);
    expect((await headsOf(tenant)).map((h) => h.code)).toEqual(["1100"]);

    const run = await backfillStandardGlHeads(pg, { dryRun: false, tenants: [tenant] });
    expect(run[0]!.inserted.sort()).toEqual(STANDARD.filter((c) => c !== "1100"));
    const after = await headsOf(tenant);
    expect(after.map((h) => h.code).sort()).toEqual(STANDARD);
    // the tenant's own head is untouched
    expect(after.find((h) => h.code === "1100")).toMatchObject({ name: "SBI Treasury Account", level: 1 });
    expect(after.find((h) => h.code === "1250")).toMatchObject({ name: "Accumulated Depreciation", classification: "capital" });

    const again = await backfillStandardGlHeads(pg, { dryRun: false, tenants: [tenant] });
    expect(again[0]!.missing).toEqual([]);
    expect(again[0]!.inserted).toEqual([]);
  });

  it("seeds 2050 as a control account and the bill head 2202 with its HoA", async () => {
    const tenant = randomUUID();
    await backfillStandardGlHeads(pg, { dryRun: false, tenants: [tenant] });
    const heads = await headsOf(tenant);
    expect(heads.find((h) => h.code === "2050")).toMatchObject({ isControl: true });
    expect(heads.find((h) => h.code === "2202")).toMatchObject({ hoaCode: BILL_HEAD_HOA, classification: "expense" });
    expect(heads.find((h) => h.code === "4100")).toMatchObject({ classification: "income" });
  });

  it("--fill-missing-hoa sets the standard HoA only on an existing standard head that has none", async () => {
    const tenant = randomUUID();
    // like UAT tenant B: an existing 2202 with no HoA, so every bill against it fails the HoA check
    await scoped(tenant, (tx) => tx.insert(financeHeads).values({
      tenantId: tenant, code: "2202", name: "General Education", level: 0, classification: "revenue", createdBy: ACTOR, updatedBy: ACTOR,
    }));
    const other = randomUUID();
    await scoped(other, (tx) => tx.insert(financeHeads).values({
      tenantId: other, code: "2202", name: "Own HoA", level: 0, classification: "expense", hoaCode: "220202101010101000", createdBy: ACTOR, updatedBy: ACTOR,
    }));

    // without the flag nothing about an existing head changes
    await backfillStandardGlHeads(pg, { dryRun: false, tenants: [tenant] });
    expect((await headsOf(tenant)).find((h) => h.code === "2202")?.hoaCode).toBeNull();

    const dry = await backfillStandardGlHeads(pg, { dryRun: true, tenants: [tenant, other], fillMissingHoa: true });
    expect(dry.map((p) => p.hoaFill)).toEqual([["2202"], []]);
    expect((await headsOf(tenant)).find((h) => h.code === "2202")?.hoaCode).toBeNull();

    const run = await backfillStandardGlHeads(pg, { dryRun: false, tenants: [tenant, other], fillMissingHoa: true });
    expect(run.map((p) => p.hoaFill)).toEqual([["2202"], []]);
    expect((await headsOf(tenant)).find((h) => h.code === "2202")).toMatchObject({ hoaCode: BILL_HEAD_HOA, name: "General Education", classification: "revenue" });
    expect((await headsOf(other)).find((h) => h.code === "2202")?.hoaCode).toBe("220202101010101000");
  });

  it("refuses a malformed tenant id", async () => {
    await expect(backfillStandardGlHeads(pg, { dryRun: true, tenants: ["tenant-a"] })).rejects.toThrow(/not a tenant uuid/);
  });
});

describe("a billing.invoice.paid journal posts once the heads exist (F91 / F92)", () => {
  it("revenue-billing -> finance.gl.post -> GL consumer writes the billing_cash_receipt journal", async () => {
    const tenant = randomUUID();
    await backfillStandardGlHeads(pg, { dryRun: false, tenants: [tenant] });
    const q = tenantWrappedQueue();
    registerRevenueBillingConsumers(q as never);
    registerGlConsumers(q as never);
    await q.start();
    const invoiceId = randomUUID();
    // exactly what billing-service emits (payments/consumer.ts, invoice-ops/consumer.ts)
    await q.publish("billing.invoice.paid", envelope("billing.invoice.paid", tenant, { invoiceId, totalMinor: "499900" }));
    await relayToCompletion(q);
    await q.stop();
    const id = deterministicId(`billing_invoice_paid:${invoiceId}`);
    const rows = await scoped(tenant, (tx) => tx.select().from(financeJournals).where(eq(financeJournals.id, id)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "billing_cash_receipt", status: "posted" });
  });
});
