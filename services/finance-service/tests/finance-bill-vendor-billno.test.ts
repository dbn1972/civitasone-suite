/**
 * POST /v1/finance/bills used to drop the caller's bill number (the internal BILL/<fy>/<seq> number is allocated by the
 * gapless allocator), so re-submitting the same vendor invoice made a second bill (6 duplicates in SMC).
 *
 * Intended behaviour (web form + user manual call the field "the vendor's bill/invoice number"; the bill detail page
 * already has an "Invoice no." field):
 *   - the caller's billNo is stored as vendor_bill_no and shown as invoiceNo; bill_no stays the internal number;
 *   - with FINANCE_VENDOR_BILL_NO_UNIQUE on: same vendor + same vendor bill number (case / spacing-insensitive) -> 409
 *     DUPLICATE_VENDOR_BILL_NO at the route and again in the consumer (race-safe); another vendor, or an earlier
 *     REJECTED bill, does not block;
 *   - default (flag off): a repeat is still accepted, exactly as today; producers that publish finance.bill.create
 *     directly (GRN, works) send no vendorBillNo and are unaffected.
 * Real Postgres, routes + the real consumer.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and, inArray } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { MemoryQueue, type Handler } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { sqlClient, db } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { scoped } from "./_tenant.js";
import { financeBills } from "../src/modules/payments/schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { financeDdo, financeVendors } from "../src/modules/masters/schema.js";
import { financeBudgetAllocation } from "../src/modules/budget/allocation-schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";
import { normaliseVendorBillNo, vendorBillNoKey, vendorBillNoUniqueEnabled } from "../src/modules/payments/domain.js";
import { fyFromDate } from "../src/modules/hoa/voucher.js";
import { COMMANDS } from "../src/topics.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = "aaaaaaaa-1111-4000-8000-0000000b0a11";
const ACTOR = "00000000-aaaa-4000-8000-0000000b0a11";
const HEAD = "b0a11000-bbbb-4000-8000-000000000001";
const V1 = "b0a11000-aaaa-4000-8000-000000000001";
const V2 = "b0a11000-aaaa-4000-8000-000000000002";
const DDO = "DDO0B0A11";
const FY = fyFromDate(new Date().toISOString().slice(0, 10));
const auth = { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["finance_officer"], sid: "sess-b0a11" }, SECRET)}` };

type Sent = { topic: string; env: Record<string, unknown> & { messageId: string } };
let sent: Sent[] = [];
let dlq: Array<{ error?: unknown; message?: unknown }> = [];
let app: Awaited<ReturnType<typeof buildApp>>;
const created: string[] = [];

function tenantWrappedQueue(): MemoryQueue {
  const q = new MemoryQueue({ maxAttempts: 1 });
  const raw = q.subscribe.bind(q);
  q.subscribe = ((topic: string, handler: Handler) => raw(topic, (msg: Parameters<Handler>[0]) => runWithTenant(msg.tenantId, () => handler(msg)))) as typeof q.subscribe;
  return q;
}
async function deliver(): Promise<void> {
  const q = tenantWrappedQueue();
  registerPaymentsConsumers(q);
  await q.start();
  const batch = sent; sent = [];
  for (const b of batch) await q.publish(b.topic, b.env as never);
  await q.drain();
  dlq = [...dlq, ...(q.dlq as never[])];
  await q.stop();
}
const body = (over: Record<string, unknown> = {}) => ({ billNo: "INV-2026/0042", vendorId: V1, headId: HEAD, ddoCode: DDO, grossMinor: "75000", ...over });
const post = (payload: Record<string, unknown>, extra: Record<string, string> = {}) =>
  app.inject({ method: "POST", url: "/v1/finance/bills", headers: { ...auth, "x-idempotency-key": randomUUID(), ...extra }, payload });
const billById = async (id: string) => (await scoped(TENANT, (tx) => tx.select().from(financeBills).where(eq(financeBills.id, id))))[0];
const billsOfVendor = (vendorId: string) => scoped(TENANT, (tx) => tx.select().from(financeBills).where(and(eq(financeBills.tenantId, TENANT), eq(financeBills.vendorId, vendorId))));

async function clean() {
  const rows = await scoped(TENANT, (tx) => tx.select({ id: financeBills.id }).from(financeBills).where(eq(financeBills.tenantId, TENANT)));
  const ids = rows.map((r) => r.id);
  await scoped(TENANT, (tx) => tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT)));
  if (ids.length) await scoped(TENANT, (tx) => tx.delete(financeBills).where(inArray(financeBills.id, ids)));
}

beforeAll(async () => {
  vi.spyOn(queue, "publish").mockImplementation((async (topic: string, env: Sent["env"]) => { sent.push({ topic, env }); }) as never);
  app = await buildApp();
  await clean();
  await scoped(TENANT, (tx) => tx.insert(financeHeads).values({
    id: HEAD, tenantId: TENANT, code: "VBN-HEAD", name: "Vendor bill number head", level: 1, classification: "expenditure",
    hoaCode: "207101010101010101", createdBy: ACTOR, updatedBy: ACTOR,
  }).onConflictDoNothing());
  await scoped(TENANT, (tx) => tx.insert(financeDdo).values({ tenantId: TENANT, ddoCode: DDO, name: "VBN DDO", createdBy: ACTOR, updatedBy: ACTOR }).onConflictDoNothing());
  for (const [id, name] of [[V1, "Vendor One"], [V2, "Vendor Two"]] as const) {
    await scoped(TENANT, (tx) => tx.insert(financeVendors).values({
      id, tenantId: TENANT, name, category: "supplies", pan: id === V1 ? "ABCDE3060F" : "ABCDE3061F", address: "1 Test Road",
      bankName: "Test Bank", bankAccountNo: "000111222333", ifsc: "TEST0001234", createdBy: ACTOR, updatedBy: ACTOR,
    }).onConflictDoNothing());
  }
  await scoped(TENANT, (tx) => tx.delete(financeBudgetAllocation).where(and(eq(financeBudgetAllocation.tenantId, TENANT), eq(financeBudgetAllocation.headId, HEAD), eq(financeBudgetAllocation.fy, FY))));
  await scoped(TENANT, (tx) => tx.insert(financeBudgetAllocation).values({
    id: "b0a11000-a110-4000-8000-000000000001", tenantId: TENANT, headId: HEAD, fy: FY,
    allocatedMinor: 100000000000n, committedMinor: 0n, actualMinor: 0n, createdBy: ACTOR, updatedBy: ACTOR,
  }));
});
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { vi.restoreAllMocks(); await clean(); await app.close(); await sqlClient.end(); });

describe("pure rules", () => {
  it("normaliseVendorBillNo trims, collapses spaces, drops placeholders, bounds the length", () => {
    expect(normaliseVendorBillNo("  INV   2026/42 ")).toBe("INV 2026/42");
    for (const v of [undefined, null, "", "  ", "undefined", "null", 7]) expect(normaliseVendorBillNo(v)).toBeNull();
    expect(normaliseVendorBillNo("X".repeat(200))).toHaveLength(64);
    expect(vendorBillNoKey("INV 2026/42")).toBe("inv 2026/42");
  });
  it("the duplicate refusal is OFF unless the flag is 1 / true / on", () => {
    expect(vendorBillNoUniqueEnabled()).toBe(false);
    for (const v of ["1", "true", "ON"]) { vi.stubEnv("FINANCE_VENDOR_BILL_NO_UNIQUE", v); expect(vendorBillNoUniqueEnabled()).toBe(true); }
    vi.stubEnv("FINANCE_VENDOR_BILL_NO_UNIQUE", "0"); expect(vendorBillNoUniqueEnabled()).toBe(false);
  });
});

describe("default (flag off): numbering as today, the vendor's number is now kept", () => {
  it("the internal number is allocated, the caller's billNo is stored as vendor_bill_no and shown as invoiceNo; a repeat is still accepted", async () => {
    const a = await post(body());
    const b = await post(body());
    expect([a.statusCode, b.statusCode]).toEqual([202, 202]);
    created.push(a.json().id, b.json().id);
    await deliver();
    expect(dlq).toHaveLength(0);
    const [ra, rb] = [await billById(a.json().id), await billById(b.json().id)];
    expect(ra?.vendorBillNo).toBe("INV-2026/0042");
    expect(rb?.vendorBillNo).toBe("INV-2026/0042");
    expect(ra?.billNo).toMatch(/^BILL/);
    expect(ra?.billNo).not.toBe("INV-2026/0042");
    expect(rb?.billNo).not.toBe(ra?.billNo);
    const detail = await app.inject({ method: "GET", url: `/v1/finance/bills/${a.json().id}`, headers: auth });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ billNo: ra?.billNo, invoiceNo: "INV-2026/0042" });
  });

  it("a producer that publishes finance.bill.create directly (no vendorBillNo) is untouched: its billNo is ignored, vendor_bill_no is NULL", async () => {
    const id = randomUUID();
    sent.push({ topic: COMMANDS.billCreate, env: {
      messageId: randomUUID(), type: COMMANDS.billCreate, tenantId: TENANT, actorId: ACTOR, correlationId: "corr-vbn", schemaVersion: "1.0",
      payload: { id, tenantId: TENANT, billNo: "BILL/GRN/ABCD1234", vendorId: V1, headId: HEAD, ddoCode: DDO, grossMinor: "1000", netMinor: "1000", currency: "INR", deductions: [], billDate: new Date().toISOString().slice(0, 10) },
    } });
    await deliver();
    const r = await billById(id);
    expect(r?.vendorBillNo).toBeNull();
    expect(r?.billNo).not.toBe("BILL/GRN/ABCD1234");
  });
});

describe("FINANCE_VENDOR_BILL_NO_UNIQUE on: same vendor + same vendor bill number -> 409", () => {
  it("route: refused for the same vendor (case / spacing-insensitive), allowed for another vendor and for a different number", async () => {
    vi.stubEnv("FINANCE_VENDOR_BILL_NO_UNIQUE", "on");
    const ok = await post(body({ billNo: "SMC-7001" }));
    expect(ok.statusCode).toBe(202);
    await deliver();
    const dup = await post(body({ billNo: "  smc-7001 " }));
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("DUPLICATE_VENDOR_BILL_NO");
    expect(JSON.stringify(dup.json())).toContain((await billById(ok.json().id))!.billNo);
    expect((await post(body({ billNo: "SMC-7001", vendorId: V2 }))).statusCode).toBe(202);
    expect((await post(body({ billNo: "SMC-7002" }))).statusCode).toBe(202);
    await deliver();
  });

  it("an idempotent replay of the SAME request (same Idempotency-Key) is a replay, not a 409", async () => {
    vi.stubEnv("FINANCE_VENDOR_BILL_NO_UNIQUE", "on");
    const key = randomUUID();
    const first = await post(body({ billNo: "SMC-7100" }), { "x-idempotency-key": key });
    expect(first.statusCode).toBe(202);
    await deliver();
    const again = await post(body({ billNo: "SMC-7100" }), { "x-idempotency-key": key });
    expect(again.statusCode).toBe(202);
    expect(again.json().id).toBe(first.json().id);
  });

  it("a rejected earlier bill does not block re-submission of the same vendor invoice", async () => {
    vi.stubEnv("FINANCE_VENDOR_BILL_NO_UNIQUE", "on");
    const first = await post(body({ billNo: "SMC-7200" }));
    await deliver();
    expect((await post(body({ billNo: "SMC-7200" }))).statusCode).toBe(409);
    await scoped(TENANT, (tx) => tx.update(financeBills).set({ status: "rejected" }).where(eq(financeBills.id, first.json().id)));
    expect((await post(body({ billNo: "SMC-7200" }))).statusCode).toBe(202);
    await deliver();
  });

  it("consumer is the race-safe guard: two commands for one vendor invoice that both passed the route -> one bill, one finance.bill.rejected DUPLICATE_VENDOR_BILL_NO, no internal number burnt", async () => {
    const mk = () => ({ id: randomUUID(), msg: randomUUID() });
    const [x, y] = [mk(), mk()];
    const before = (await billsOfVendor(V1)).length;
    for (const c of [x, y]) {
      sent.push({ topic: COMMANDS.billCreate, env: {
        messageId: c.msg, type: COMMANDS.billCreate, tenantId: TENANT, actorId: ACTOR, correlationId: "corr-vbn-race", schemaVersion: "1.0",
        payload: { id: c.id, tenantId: TENANT, billNo: "SMC-7300", vendorBillNo: "SMC-7300", vendorId: V1, headId: HEAD, ddoCode: DDO, grossMinor: "5000", netMinor: "5000", currency: "INR", deductions: [], billDate: new Date().toISOString().slice(0, 10) },
      } });
    }
    vi.stubEnv("FINANCE_VENDOR_BILL_NO_UNIQUE", "1");
    await deliver();
    expect((await billsOfVendor(V1)).length - before).toBe(1);
    const rejected = await scoped(TENANT, (tx) => tx.select().from(outboxMessages).where(and(eq(outboxMessages.tenantId, TENANT), eq(outboxMessages.topic, "finance.bill.rejected"))));
    expect(rejected.some((r) => (r.payload as { code?: string }).code === "DUPLICATE_VENDOR_BILL_NO")).toBe(true);
    // the loser is visible to the maker: GET /v1/finance/bills/:id/status shows the winner as created and the loser as
    // rejected with the stable code and a readable reason (no code prefix)
    const outcomes = await Promise.all([x, y].map(async (c) => (await app.inject({ method: "GET", url: `/v1/finance/bills/${c.id}/status`, headers: auth })).json()));
    const created = outcomes.filter((o) => o.state === "created");
    const refused = outcomes.filter((o) => o.state === "rejected");
    expect(created).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ code: "DUPLICATE_VENDOR_BILL_NO" });
    expect(refused[0].reason).toBe(`vendor bill number SMC-7300 was already lodged for this vendor as ${created[0].billNo}`);
    expect((await app.inject({ method: "GET", url: `/v1/finance/bills/${randomUUID()}/status`, headers: auth })).json().state).toBe("pending");
    // the refused command is not marked processed, so it can be re-driven once the first bill is rejected / fixed
    expect(await db.select().from(processed).where(inArray(processed.messageId, [x.msg, y.msg]))).toHaveLength(1);
  });
});
