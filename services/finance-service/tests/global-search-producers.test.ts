/**
 * Cross-module search producers in finance (real DB): flag-off parity, event on create / update / status change,
 * tenant stamping, and that nothing personal (vendor PAN, phone, e-mail, bank account, IFSC) reaches the event.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { outboxMessages } from "../src/shared/outbox.js";
import { financeVendors } from "../src/modules/masters/schema.js";
import { financeBills } from "../src/modules/payments/schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { insertBill, updateBill } from "../src/modules/payments/repo.js";
import { insertJournal, markJournalReversed } from "../src/modules/gl/repo.js";
import { scoped } from "./_tenant.js";
import { bearer, wipeOutbox } from "./_fp02.js";
import { findSensitive, runGlobalSearchCli, type GlobalSearchDocument } from "@civitasone/search";
import { withTenantScope } from "@civitasone/db";
import { db } from "../src/shared/db.js";
import { backfillEntities } from "../src/shared/global-search.js";

const T = "bbbbbbbb-5ea0-4000-8000-000000000001";
const OTHER = "bbbbbbbb-5ea0-4000-8000-000000000002";
const MAKER = "00000000-5ea0-4000-8000-0000000000a1";

let n = 0;
const nextPan = () => `ZZPAN${String(1000 + ++n)}Z`;
const PAN = "ZZPAN9999Z";
const HEAD = (t: string) => `${t.slice(0, 24)}0000000000ee`;
const PHONE = "9876543210";
const EMAIL = "asha.verma@vendor.example";
const ACCT = "123456789012";
const IFSC = "TEST0123456";

let app: Awaited<ReturnType<typeof buildApp>>;
const saved = { ...process.env };

const searchEvents = async (tenant: string) =>
  (await scoped(tenant, (tx) => tx.select().from(outboxMessages)
    .where(and(eq(outboxMessages.tenantId, tenant), eq(outboxMessages.topic, "search.index.update"))))) as Array<{ tenantId: string; payload: Record<string, unknown> }>;

async function postVendor(tenant: string, name: string) {
  const res = await app.inject({
    method: "POST", url: "/v1/finance/vendors", headers: bearer(tenant, MAKER, ["finance_admin"]),
    payload: { name, category: "supplies", pan: nextPan(), address: "1 Test Road", phone: PHONE, email: EMAIL, bankName: "Test Bank", bankAccount: ACCT, ifsc: IFSC },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

describe("finance -> global search producers (real DB)", () => {
  beforeAll(async () => {
    app = await buildApp();
    for (const t of [T, OTHER]) {
      await scoped(t, (tx) => tx.insert(financeHeads).values({ id: HEAD(t), tenantId: t, code: "5EA0-H2", name: "Search test head", level: 2, createdBy: MAKER, updatedBy: MAKER }).onConflictDoNothing());
    }
  });
  afterAll(async () => {
    for (const t of [T, OTHER]) {
      await wipeOutbox(t);
      await scoped(t, async (tx) => {
        await tx.delete(financeVendors).where(eq(financeVendors.tenantId, t));
        await tx.delete(financeBills).where(eq(financeBills.tenantId, t));
        await tx.delete(financeHeads).where(eq(financeHeads.tenantId, t));
      });
    }
  });
  beforeEach(async () => {
    delete process.env.GLOBAL_SEARCH_TENANTS;
    delete process.env.GLOBAL_SEARCH_DISABLED;
    await wipeOutbox(T);
    await wipeOutbox(OTHER);
  });
  afterEach(() => { process.env = { ...saved }; });

  it("flag off (default): creating and changing records writes no search event", async () => {
    const id = await postVendor(T, "Parity Traders");
    await scoped(T, (tx) => insertBill(tx, mkBill(T, "BILL-PARITY-1")));
    expect(await searchEvents(T)).toEqual([]);
    expect(id).toBeTruthy();
  });

  it("flag on: a created vendor produces one tenant-stamped upsert, with no personal data", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = T;
    const id = await postVendor(T, "Acme Traders");
    const ev = await searchEvents(T);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.tenantId).toBe(T);
    expect(ev[0]!.payload).toMatchObject({ id, tenantId: T, module: "finance", entityType: "finance.vendor", name: "Acme Traders", action: "upsert" });
    const wire = JSON.stringify(ev[0]!.payload);
    for (const secret of [PAN, PHONE, EMAIL, ACCT, IFSC, "1 Test Road"]) expect(wire).not.toContain(secret);
    // Content fields only: ids are UUIDs (their last group can be 12 digits, which the account-number pattern would flag).
    const { id: _id, tenantId: _t, ...content } = ev[0]!.payload;
    expect(findSensitive(JSON.stringify(content))).toEqual([]);
  });

  it("flag on for another tenant only: this tenant still writes nothing", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = OTHER;
    await postVendor(T, "Not Flagged Traders");
    expect(await searchEvents(T)).toEqual([]);
  });

  it("a bill insert and a status change each publish an upsert carrying the current status", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = T;
    const b = mkBill(T, "BILL-2026-0042");
    await scoped(T, (tx) => insertBill(tx, b));
    await scoped(T, (tx) => updateBill(tx, b.id!, { status: "passed", updatedBy: MAKER }));
    const ev = (await searchEvents(T)).map((e) => e.payload);
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ entityType: "finance.bill", id: b.id, name: "Bill BILL-2026-0042", refNumber: "BILL-2026-0042", status: "pending", action: "upsert" });
    expect(ev[1]).toMatchObject({ status: "passed" });
  });

  it("sample bills are never indexed (they are published as a removal, not an upsert)", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = T;
    const b = { ...mkBill(T, "BILL-SAMPLE-1"), isSample: true };
    await scoped(T, (tx) => insertBill(tx, b));
    expect((await searchEvents(T)).map((e) => e.payload.action)).toEqual(["delete"]);
  });

  it("a voucher (journal) publishes on insert and again when it is reversed", async () => {
    process.env.GLOBAL_SEARCH_TENANTS = T;
    const jid = randomUUID();
    const voucherNo = `JV-${jid.slice(0, 8)}`;
    await scoped(T, (tx) => insertJournal(tx, {
      id: jid, tenantId: T, voucherNo, type: "journal", postingDate: "2026-11-01", lines: [], status: "posted", createdBy: MAKER, updatedBy: MAKER,
    }));
    await scoped(T, (tx) => markJournalReversed(tx, jid, MAKER));
    const ev = (await searchEvents(T)).map((e) => e.payload);
    expect(ev.map((p) => p.status)).toEqual(["posted", "reversed"]);
    expect(ev[0]).toMatchObject({ entityType: "finance.voucher", refNumber: voucherNo });
  });
});

describe("finance backfill over real rows", () => {
  const BT = "bbbbbbbb-5ea0-4000-8000-0000000000b1";
  const withTenant = ((fn: (tx: never) => Promise<unknown>) => withTenantScope(db, BT, (tx) => fn(tx as never))) as never;
  const fakeIndex = () => {
    const docs: GlobalSearchDocument[] = [];
    return { docs, initialize: async () => undefined, upsert: async (d: GlobalSearchDocument[]) => { docs.push(...d); return 1; }, removeTenant: async () => 1, waitForTask: async () => undefined };
  };
  beforeAll(async () => {
    process.env.GLOBAL_SEARCH_TENANTS = BT;
    app = app ?? (await buildApp());
    await scoped(BT, (tx) => tx.insert(financeHeads).values({ id: HEAD(BT), tenantId: BT, code: "5EA0-H3", name: "Backfill head", level: 2, createdBy: MAKER, updatedBy: MAKER }).onConflictDoNothing());
    for (let i = 1; i <= 5; i++) await scoped(BT, (tx) => insertBill(tx, mkBill(BT, `BILL-BF-${i}`)));
    await scoped(BT, (tx) => insertBill(tx, { ...mkBill(BT, "BILL-BF-SAMPLE"), isSample: true }));
    await wipeOutbox(BT);
    // a vendor holding every kind of personal data, inserted directly
    const res = await app.inject({ method: "POST", url: "/v1/finance/vendors", headers: bearer(BT, MAKER, ["finance_admin"]),
      payload: { name: "Backfill Vendor", category: "supplies", pan: "ZZPAN7777Z", address: "9 Test Road", phone: PHONE, email: EMAIL, bankName: "Test Bank", bankAccount: ACCT, ifsc: IFSC } });
    expect(res.statusCode).toBe(201);
  });
  afterAll(async () => {
    await wipeOutbox(BT);
    await scoped(BT, async (tx) => { await tx.delete(financeBills).where(eq(financeBills.tenantId, BT)); await tx.delete(financeVendors).where(eq(financeVendors.tenantId, BT)); await tx.delete(financeHeads).where(eq(financeHeads.tenantId, BT)); });
  });

  it("dry run counts rows and writes nothing; sample bills are skipped", async () => {
    const idx = fakeIndex(); const out: string[] = [];
    const rs = await runGlobalSearchCli(["--tenant", BT], (t) => backfillEntities(t, withTenant), { out: (l) => out.push(l) }, idx);
    expect(idx.docs).toEqual([]);
    const bills = rs[1]!;
    expect(bills).toMatchObject({ dryRun: true, scanned: 6, indexed: 5, skipped: 1 });
    expect(out.join("\n")).toContain("dry run only");
  });
  it("--apply is capped and resumable and indexes only this tenant's non-personal fields", async () => {
    const idx = fakeIndex();
    const first = await runGlobalSearchCli(["--tenant", BT, "--apply", "--only", "finance.bill", "--limit", "3"], (t) => backfillEntities(t, withTenant), { out: () => undefined }, idx);
    expect(first[0]).toMatchObject({ scanned: 3, done: false });
    const second = await runGlobalSearchCli(["--tenant", BT, "--apply", "--only", "finance.bill", "--limit", "10", "--after", first[0]!.lastId!], (t) => backfillEntities(t, withTenant), { out: () => undefined }, idx);
    expect(second[0]).toMatchObject({ scanned: 3, done: true });
    expect(idx.docs.map((d) => d.refNumber).sort()).toEqual(["BILL-BF-1", "BILL-BF-2", "BILL-BF-3", "BILL-BF-4", "BILL-BF-5"]);
    await runGlobalSearchCli(["--tenant", BT, "--apply", "--only", "finance.vendor"], (t) => backfillEntities(t, withTenant), { out: () => undefined }, idx);
    for (const d of idx.docs) expect(d.tenantId).toBe(BT);
    // no PAN / Aadhaar / bank / phone / e-mail anywhere in what would be indexed
    const content = JSON.stringify(idx.docs.map((d) => [d.title, d.refNumber, d.status, d.summary]));
    expect(findSensitive(content)).toEqual([]);
    for (const secret of ["ZZPAN7777Z", PHONE, EMAIL, ACCT, IFSC, "9 Test Road"]) expect(JSON.stringify(idx.docs)).not.toContain(secret);
    expect(idx.docs.some((d) => d.title === "Backfill Vendor")).toBe(true);
  });
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

function mkBill(tenantId: string, billNo: string) {
  return {
    id: randomUUID(), tenantId, billNo, vendorId: randomUUID(), headId: HEAD(tenantId), status: "pending", stage: "section",
    createdBy: MAKER, updatedBy: MAKER,
  } as Parameters<typeof insertBill>[1];
}
