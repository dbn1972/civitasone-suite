/**
 * AR sub-ledger opening-balance import (real Postgres; routes + the real consumers, the fp01 capture-and-deliver harness):
 *  - POST /v1/finance/ar/opening-balances raises a maker-checker request; only finance_admin / super_admin may; the
 *    approver must differ from the maker; the approval writes finance_ar_ledger ONLY (no journal, no GL ledger row).
 *  - idempotent on demand_id: never duplicates a row the billing consumer wrote; a replay is a no-op.
 *  - backfill: dry run lists billing invoices on control 1300 with no AR row; applying it brings the AR sub-ledger vs
 *    GL reconciliation to difference 0.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { sql, and, eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { MemoryQueue, type Handler } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { scoped } from "./_tenant.js";
import { registerApprovalsConsumers } from "../src/modules/approvals/consumer.js";
import { registerGlConsumers } from "../src/modules/gl/consumer.js";
import { registerRevenueBillingConsumers } from "../src/modules/revenue-billing/consumer.js";
import { registerSubledgerConsumers } from "../src/modules/subledger/consumer.js";
import { agingBucket, subjectKeyFor, arOpeningEntrySchema } from "../src/modules/subledger/opening-import.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET as string;
const ADMIN_A = "00000000-aaaa-4000-8000-0000000ac001";
const ADMIN_B = "00000000-aaaa-4000-8000-0000000ac002";
const OFFICER = "00000000-aaaa-4000-8000-0000000ac003";
const T1 = randomUUID(); // manual import + gating
const T2 = randomUUID(); // billing backfill (8 invoices posted before the consumer existed)
const as = (t: string, sub: string, roles = ["finance_admin"]) => ({ authorization: `Bearer ${signToken({ sub, tid: t, roles, sid: `s-${sub.slice(-3)}` }, SECRET)}` });

type Sent = { topic: string; env: Record<string, unknown> & { messageId: string } };
let sent: Sent[] = [];
let app: Awaited<ReturnType<typeof buildApp>>;
let dlq: unknown[] = [];
function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue({ maxAttempts: 1 });
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) => raw(topic, (msg: Parameters<Handler>[0]) => runWithTenant(msg.tenantId, () => handler(msg)))) as typeof q.subscribe;
  return q;
}
/** Deliver everything the routes captured; `ar` registers the AR sub-ledger consumer (it did not exist for the 8 old invoices). */
async function deliver(opts: { ar?: boolean } = {}): Promise<void> {
  const q = tenantWrappedQueue();
  registerApprovalsConsumers(q); registerGlConsumers(q); registerRevenueBillingConsumers(q);
  if (opts.ar) registerSubledgerConsumers(q);
  await q.start();
  const batch = sent; sent = [];
  for (const b of batch) await q.publish(b.topic, b.env as never);
  await q.drain();
  dlq = [...dlq, ...q.dlq];
  await q.stop();
}
const call = (method: "GET" | "POST", url: string, headers: Record<string, string>, payload?: unknown) =>
  app.inject({ method, url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
const rows = async <T = Record<string, unknown>>(t: string, q: ReturnType<typeof sql>): Promise<T[]> => {
  const r: any = await scoped(t, (tx) => tx.execute(q)); return (Array.isArray(r) ? r : r.rows ?? []) as T[];
};
const count = async (t: string, table: string) => Number((await rows<{ n: string }>(t, sql`SELECT COUNT(*)::int AS n FROM ${sql.raw(table)} WHERE tenant_id = ${t}::uuid`))[0]!.n);
const recon = async (t: string) => (await call("GET", "/v1/finance/subledger-gl-reconciliation?side=ar", as(t, ADMIN_A))).json().data as Record<string, unknown>;
const REASON = "Opening balance import for invoices posted before the AR consumer existed";

/**
 * Post billing.invoice.issued through the real revenue-billing consumer, then relay its journalPost outbox rows into the
 * real GL consumer. The AR sub-ledger consumer is NOT registered and its ar.sync outbox rows are never relayed: that is
 * the state the 8 old invoices were in (posted before the consumer existed).
 */
async function postInvoicesToGl(t: string, invoices: Array<{ id: string; total: string; date: string }>) {
  const q = tenantWrappedQueue();
  registerRevenueBillingConsumers(q);
  await q.start();
  for (const inv of invoices) {
    await q.publish("billing.invoice.issued", {
      messageId: randomUUID(), type: "billing.invoice.issued", tenantId: t, actorId: ADMIN_A, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { invoiceId: inv.id, totalMinor: inv.total, issuedDate: inv.date },
    } as never);
  }
  await q.drain();
  dlq = [...dlq, ...q.dlq];
  await q.stop();
  const posts = await scoped(t, (tx) => tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, t), eq(outboxMessages.topic, COMMANDS.journalPost))));
  const g = tenantWrappedQueue();
  registerGlConsumers(g);
  await g.start();
  for (const m of posts as Array<{ id: string; topic: string; tenantId: string; actorId: string; correlationId: string; payload: Record<string, unknown> }>) {
    await g.publish(m.topic, { messageId: m.id, type: m.topic, tenantId: m.tenantId, actorId: m.actorId, correlationId: m.correlationId, schemaVersion: "1.0", payload: m.payload } as never);
  }
  await g.drain();
  dlq = [...dlq, ...g.dlq];
  await g.stop();
}

beforeAll(async () => {
  vi.spyOn(queue, "publish").mockImplementation((async (topic: string, env: Sent["env"]) => { sent.push({ topic, env }); }) as never);
  app = await buildApp();
  for (const t of [T1, T2]) {
    for (const [code, name, cls] of [["1300", "Billing receivable", "asset"], ["4010", "SaaS revenue", "income"], ["1100", "Cash / Bank", "asset"]] as const) {
      await scoped(t, (tx) => tx.insert(financeHeads).values({ id: randomUUID(), tenantId: t, code, name, level: 1, classification: cls, createdBy: ADMIN_A, updatedBy: ADMIN_A }));
    }
  }
});
afterAll(async () => { vi.restoreAllMocks(); await app.close(); await sqlClient.end(); });

describe("pure rules", () => {
  it("aging buckets by days past due (invoice date when no due date)", () => {
    expect(agingBucket("2026-11-01", "2026-11-12")).toBe("0-30");
    expect(agingBucket("2026-09-30", "2026-11-12")).toBe("31-60");
    expect(agingBucket("2026-08-30", "2026-11-12")).toBe("61-90");
    expect(agingBucket("2026-06-01", "2026-11-12")).toBe("91-180");
    expect(agingBucket("2025-01-01", "2026-11-12")).toBe("180+");
  });
  it("entry validation: positive paise, real dates, received <= amount, due >= invoice", () => {
    const ok = { debtorName: "Acme", demandId: randomUUID(), amountMinor: "100", invoiceDate: "2026-04-01" };
    expect(arOpeningEntrySchema.safeParse(ok).success).toBe(true);
    expect(arOpeningEntrySchema.safeParse({ ...ok, amountMinor: "0" }).success).toBe(false);
    expect(arOpeningEntrySchema.safeParse({ ...ok, amountMinor: "-5" }).success).toBe(false);
    expect(arOpeningEntrySchema.safeParse({ ...ok, invoiceDate: "2026-02-31" }).success).toBe(false);
    expect(arOpeningEntrySchema.safeParse({ ...ok, receivedMinor: "101" }).success).toBe(false);
    expect(arOpeningEntrySchema.safeParse({ ...ok, dueDate: "2026-03-01" }).success).toBe(false);
  });
  it("subject key ignores order and case", () => {
    const a = randomUUID(), b = randomUUID();
    expect(subjectKeyFor([{ demandId: a }, { demandId: b }])).toBe(subjectKeyFor([{ demandId: b.toUpperCase() }, { demandId: a }]));
  });
});

describe("POST /v1/finance/ar/opening-balances", () => {
  const d1 = randomUUID(), d2 = randomUUID();
  const entries = [
    { debtorName: "Sample Municipal Council", demandId: d1, amountMinor: "150000", invoiceDate: "2026-04-10", dueDate: "2026-05-10" },
    { debtorName: "Sample Municipal Council", demandId: d2, amountMinor: "50000", receivedMinor: "20000", invoiceDate: "2026-06-01" },
  ];
  let requestId = "";

  it("is finance_admin / super_admin only, validates the body, and writes nothing on request", async () => {
    expect((await call("POST", "/v1/finance/ar/opening-balances", as(T1, OFFICER, ["finance_officer"]), { entries, reason: REASON })).statusCode).toBe(403);
    expect((await call("POST", "/v1/finance/ar/opening-balances", as(T1, ADMIN_A), { entries, reason: "short" })).statusCode).toBe(400);
    expect((await call("POST", "/v1/finance/ar/opening-balances", as(T1, ADMIN_A), { entries: [], reason: REASON })).statusCode).toBe(400);
    expect((await call("POST", "/v1/finance/ar/opening-balances", as(T1, ADMIN_A), { entries: [entries[0], entries[0]], reason: REASON })).statusCode).toBe(400);
    const res = await call("POST", "/v1/finance/ar/opening-balances", as(T1, ADMIN_A), { entries, reason: REASON });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ status: "pending_approval", entryCount: 2, totalMinor: "180000", alreadyPresent: [] });
    requestId = res.json().id;
    await deliver();
    expect(await count(T1, "gl.finance_ar_ledger")).toBe(0); // nothing is written until a checker approves
    // a second request for the same invoices while one is pending is refused
    expect((await call("POST", "/v1/finance/ar/opening-balances", as(T1, ADMIN_B), { entries, reason: REASON })).statusCode).toBe(409);
  });

  it("maker-checker: the maker cannot approve their own request, a different admin can; AR rows only, NO journal", async () => {
    const own = await call("POST", `/v1/finance/change-requests/${requestId}/approve`, as(T1, ADMIN_A), {});
    expect(own.statusCode).toBe(409);
    expect(own.json().code ?? own.json().error?.code).toBe("MAKER_CHECKER_VIOLATION");
    expect((await call("POST", `/v1/finance/change-requests/${requestId}/approve`, as(T1, OFFICER, ["finance_officer"]), {})).statusCode).toBe(403);

    const journalsBefore = await count(T1, "gl.finance_journals");
    const ledgerBefore = await count(T1, "gl.finance_ledger");
    expect((await call("POST", `/v1/finance/change-requests/${requestId}/approve`, as(T1, ADMIN_B), {})).statusCode).toBe(202);
    await deliver();
    expect(dlq).toHaveLength(0);

    const ar = await rows<Record<string, string>>(T1, sql`SELECT demand_id::text, debtor_name, amount_minor::text, received_minor::text, balance_minor::text, status, aging_bucket, source, due_date::text FROM gl.finance_ar_ledger WHERE tenant_id = ${T1}::uuid ORDER BY invoice_date`);
    expect(ar).toHaveLength(2);
    expect(ar[0]).toMatchObject({ demand_id: d1, debtor_name: "Sample Municipal Council", amount_minor: "150000", balance_minor: "150000", status: "open", source: "opening_import", due_date: "2026-05-10" });
    expect(ar[1]).toMatchObject({ demand_id: d2, received_minor: "20000", balance_minor: "30000", status: "partial" });
    expect(await count(T1, "gl.finance_journals")).toBe(journalsBefore);
    expect(await count(T1, "gl.finance_ledger")).toBe(ledgerBefore);
    const cr = await rows<{ status: string }>(T1, sql`SELECT status FROM gl.finance_change_requests WHERE id = ${requestId}::uuid`);
    expect(cr[0]!.status).toBe("approved");
  });

  it("idempotent: a repeat request is refused 409 once every demand_id has a row; a partly-new one imports only the new row", async () => {
    expect((await call("POST", "/v1/finance/ar/opening-balances", as(T1, ADMIN_A), { entries, reason: REASON })).statusCode).toBe(409);
    const d3 = randomUUID();
    const mixed = [entries[0], { debtorName: "Sample Municipal Council", demandId: d3, amountMinor: "7000", invoiceDate: "2026-07-01" }];
    const res = await call("POST", "/v1/finance/ar/opening-balances", as(T1, ADMIN_A), { entries: mixed, reason: REASON });
    expect(res.statusCode).toBe(202);
    expect(res.json().alreadyPresent).toEqual([d1]);
    await deliver();
    expect((await call("POST", `/v1/finance/change-requests/${res.json().id}/approve`, as(T1, ADMIN_B), {})).statusCode).toBe(202);
    await deliver();
    expect(await count(T1, "gl.finance_ar_ledger")).toBe(3); // d1 not duplicated
    expect(Number((await rows<{ n: number }>(T1, sql`SELECT COUNT(*)::int AS n FROM gl.finance_ar_ledger WHERE tenant_id = ${T1}::uuid AND demand_id = ${d1}::uuid`))[0]!.n)).toBe(1);
  });

  it("never duplicates a row the billing consumer already wrote (either order)", async () => {
    const inv = randomUUID();
    // consumer wrote it first ...
    const q = tenantWrappedQueue(); registerSubledgerConsumers(q); await q.start();
    await q.publish("finance.subledger.ar.sync", { messageId: randomUUID(), type: "finance.subledger.ar.sync", tenantId: T1, actorId: ADMIN_A, correlationId: randomUUID(), schemaVersion: "1.0", payload: { event: "issued", invoiceId: inv, totalMinor: "9900", date: "2026-11-01" } } as never);
    await q.drain(); await q.stop();
    const res = await call("POST", "/v1/finance/ar/opening-balances", as(T1, ADMIN_A), { entries: [{ debtorName: "X", demandId: inv, amountMinor: "9900", invoiceDate: "2026-11-01" }], reason: REASON });
    expect(res.statusCode).toBe(409);
    // ... and a request raised BEFORE the consumer wrote it applies as a skip, not a duplicate
    const inv2 = randomUUID();
    const r2 = await call("POST", "/v1/finance/ar/opening-balances", as(T1, ADMIN_A), { entries: [{ debtorName: "X", demandId: inv2, amountMinor: "100", invoiceDate: "2026-11-01" }], reason: REASON });
    expect(r2.statusCode).toBe(202);
    await deliver();
    const q2 = tenantWrappedQueue(); registerSubledgerConsumers(q2); await q2.start();
    await q2.publish("finance.subledger.ar.sync", { messageId: randomUUID(), type: "finance.subledger.ar.sync", tenantId: T1, actorId: ADMIN_A, correlationId: randomUUID(), schemaVersion: "1.0", payload: { event: "issued", invoiceId: inv2, totalMinor: "100", date: "2026-11-01" } } as never);
    await q2.drain(); await q2.stop();
    expect((await call("POST", `/v1/finance/change-requests/${r2.json().id}/approve`, as(T1, ADMIN_B), {})).statusCode).toBe(202);
    await deliver();
    expect(Number((await rows<{ n: number }>(T1, sql`SELECT COUNT(*)::int AS n FROM gl.finance_ar_ledger WHERE tenant_id = ${T1}::uuid AND demand_id = ${inv2}::uuid`))[0]!.n)).toBe(1);
  });
});

describe("backfill: 8 billing invoices on GL 1300 with no AR row", () => {
  const invoices = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => ({ id: randomUUID(), total: i <= 4 ? "50000" : "70000", date: `2026-1${i % 2}-0${i}` })); 
  const expectedTotal = invoices.reduce((s, i) => s + BigInt(i.total), 0n);
  let requestId = "";

  it("GL holds the invoices, the AR sub-ledger holds none: the reconciliation shows the gap", async () => {
    await postInvoicesToGl(T2, invoices);
    expect(dlq).toHaveLength(0);
    const r = await recon(T2);
    expect(r).toMatchObject({ controlAccountResolved: true, controlAccountBalanceMinor: expectedTotal.toString(), subledgerBalanceMinor: "0", isReconciled: false });
    expect(await count(T2, "gl.finance_ar_ledger")).toBe(0);
  });

  it("dry run (the default) lists exactly those invoices and writes nothing", async () => {
    sent = [];
    const res = await call("POST", "/v1/finance/ar/opening-balances/backfill", as(T2, ADMIN_A), {});
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.dryRun).toBe(true);
    expect(b.candidateCount).toBe(8);
    expect(b.candidates.map((c: { demandId: string }) => c.demandId).sort()).toEqual(invoices.map((i) => i.id).sort());
    expect(b.candidateOpenMinor).toBe(expectedTotal.toString());
    expect(b.differenceMinor).toBe((-expectedTotal).toString());
    expect(b.differenceAfterMinor).toBe("0");
    expect(await count(T2, "gl.finance_ar_ledger")).toBe(0);
    expect(sent.filter((s) => s.topic === "finance.change_request.submit")).toHaveLength(0);
    expect((await call("POST", "/v1/finance/ar/opening-balances/backfill", as(T2, OFFICER, ["finance_officer"]), {})).statusCode).toBe(403);
  });

  it("applying needs a reason, raises one maker-checker request, and the approval brings the reconciliation to difference 0", async () => {
    expect((await call("POST", "/v1/finance/ar/opening-balances/backfill", as(T2, ADMIN_A), { dryRun: false })).statusCode).toBe(400);
    const res = await call("POST", "/v1/finance/ar/opening-balances/backfill", as(T2, ADMIN_A), { dryRun: false, reason: REASON });
    expect(res.statusCode).toBe(202);
    requestId = res.json().id;
    await deliver();
    expect(await count(T2, "gl.finance_ar_ledger")).toBe(0);
    expect((await call("POST", `/v1/finance/change-requests/${requestId}/approve`, as(T2, ADMIN_A), {})).statusCode).toBe(409); // maker
    const journalsBefore = await count(T2, "gl.finance_journals");
    expect((await call("POST", `/v1/finance/change-requests/${requestId}/approve`, as(T2, ADMIN_B), {})).statusCode).toBe(202);
    await deliver();
    expect(dlq).toHaveLength(0);
    expect(await count(T2, "gl.finance_ar_ledger")).toBe(8);
    expect(await count(T2, "gl.finance_journals")).toBe(journalsBefore); // AR-only: no journal
    const r = await recon(T2);
    expect(r).toMatchObject({ subledgerBalanceMinor: expectedTotal.toString(), controlAccountBalanceMinor: expectedTotal.toString(), differenceMinor: "0", isReconciled: true });
    const sample = (await rows<Record<string, string>>(T2, sql`SELECT debtor_id::text, debtor_name, status, source, change_request_id::text FROM gl.finance_ar_ledger WHERE tenant_id = ${T2}::uuid LIMIT 1`))[0]!;
    expect(sample).toMatchObject({ debtor_id: T2, debtor_name: "Platform subscription billing", status: "open", source: "opening_import", change_request_id: requestId });
  });

  it("a second dry run finds nothing and a second apply is refused (idempotent)", async () => {
    const dry = await call("POST", "/v1/finance/ar/opening-balances/backfill", as(T2, ADMIN_A), {});
    expect(dry.json()).toMatchObject({ candidateCount: 0, differenceMinor: "0" });
    expect((await call("POST", "/v1/finance/ar/opening-balances/backfill", as(T2, ADMIN_A), { dryRun: false, reason: REASON })).statusCode).toBe(409);
  });
});
