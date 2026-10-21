/**
 * GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-03: an advance's payee is picked from a master list and its id is stored.
 *   - POST /v1/finance/advances takes an optional payeeId. employee -> opaque id (stored as sent); vendor -> must be an
 *     ACTIVE vendor of this tenant, and the register shows the vendor's master name; other -> no id allowed.
 *   - the consumer stores payee_id (migration 0150); the list never returns it (it identifies a natural person).
 * GAP-FINANCE-EXPENDITURE-ADVANCES-03: the free-text reason is masked with the name for roles not entitled to it.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { MemoryQueue } from "@civitasone/queue";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { scoped } from "./_tenant.js";
import { financeAdvances } from "../src/modules/payments/schema.js";
import { financeVendors } from "../src/modules/masters/schema.js";
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";
import { maskAdvanceBeneficiaries } from "../src/modules/payments/domain.js";
import { COMMANDS } from "../src/topics.js";
import { bearer } from "./_fp02.js";

// finance_advances rows are tenant-scoped; each run gets its own tenants.
const T = randomUUID();
const OTHER = randomUUID();
const ACTOR = "00000000-0f02-4000-8000-000000000081";
const EMPLOYEE_ID = randomUUID();
const VENDOR = randomUUID();
const INACTIVE_VENDOR = randomUUID();
const FOREIGN_VENDOR = randomUUID();
let app: Awaited<ReturnType<typeof buildApp>>;
const officer = (tenant = T) => bearer(tenant, ACTOR, ["finance_officer"]);
const BASE = { purpose: "Tour advance", sanctionAuthority: "Under Secretary", reason: "Sanctioned by order", amountMinor: "100000" };
let seq = 0;
const create = (body: Record<string, unknown>, tenant = T) =>
  app.inject({ method: "POST", url: "/v1/finance/advances", headers: officer(tenant), payload: { ...BASE, advanceNo: `ADV-PP-${++seq}-${Date.now()}`, ...body } });

const vendorRow = (id: string, tenantId: string, name: string, pan: string, isActive = true) => ({
  id, tenantId, name, category: "supplies", pan, address: "1 Road", bankName: "SBI", bankAccountNo: "000111222333", ifsc: "SBIN0001234",
  isActive, status: isActive ? "active" : "inactive", createdBy: ACTOR, updatedBy: ACTOR,
});

beforeAll(async () => {
  app = await buildApp();
  await scoped(T, (tx) => tx.insert(financeVendors).values([
    vendorRow(VENDOR, T, "M/s Master Name Traders", "PPAAA1111A"),
    vendorRow(INACTIVE_VENDOR, T, "M/s Dormant Co", "PPAAA2222B", false),
  ]));
  await scoped(OTHER, (tx) => tx.insert(financeVendors).values([vendorRow(FOREIGN_VENDOR, OTHER, "M/s Other Tenant Co", "PPAAA3333C")]));
});
afterAll(async () => { await app.close(); await sqlClient.end(); });
afterEach(() => { vi.restoreAllMocks(); });

/** Run the create command a route published through the real consumer, on a throwaway in-memory queue. */
async function consume(published: { topic: string; msg: Record<string, unknown> }): Promise<void> {
  const q = new MemoryQueue({ maxAttempts: 1 });
  registerPaymentsConsumers(q);
  await q.start();
  await q.publish(published.topic, published.msg as never);
  await q.drain();
  await q.stop();
  expect(q.dlq).toHaveLength(0);
}
function spyPublish() {
  const published: Array<{ topic: string; msg: Record<string, unknown> }> = [];
  vi.spyOn(queue, "publish").mockImplementation(async (topic: string, msg: unknown) => { published.push({ topic, msg: msg as Record<string, unknown> }); });
  return published;
}

describe("POST /v1/finance/advances with a picked payee", () => {
  it("a vendor id of this tenant is accepted, and the register gets the vendor's MASTER name, not the typed text", async () => {
    const published = spyPublish();
    const res = await create({ type: "vendor", payee: "something typed by the client", payeeId: VENDOR });
    expect(res.statusCode).toBe(202);
    const msg = published.find((p) => p.topic === COMMANDS.advanceCreate)!.msg;
    expect((msg.payload as Record<string, unknown>)).toMatchObject({ payee: "M/s Master Name Traders", payeeId: VENDOR, type: "vendor" });
  });

  it("an unknown vendor id is 404 with a payeeId field error, and nothing is queued", async () => {
    const published = spyPublish();
    const res = await create({ type: "vendor", payee: "Ghost Co", payeeId: randomUUID() });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "VENDOR_NOT_FOUND", fieldErrors: [{ field: "payeeId" }] });
    expect(published).toHaveLength(0);
  });

  it("another tenant's vendor is just as unknown (tenant-scoped lookup)", async () => {
    const published = spyPublish();
    const res = await create({ type: "vendor", payee: "M/s Other Tenant Co", payeeId: FOREIGN_VENDOR });
    expect(res.statusCode).toBe(404);
    expect(published).toHaveLength(0);
  });

  it("a deactivated vendor is 409 VENDOR_INACTIVE with a payeeId field error", async () => {
    const published = spyPublish();
    const res = await create({ type: "vendor", payee: "M/s Dormant Co", payeeId: INACTIVE_VENDOR });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "VENDOR_INACTIVE", fieldErrors: [{ field: "payeeId" }] });
    expect(published).toHaveLength(0);
  });

  it("an employee id is accepted as an opaque reference and the typed display name is kept", async () => {
    const published = spyPublish();
    const res = await create({ type: "employee", payee: "Asha Verma (E-1001)", payeeId: EMPLOYEE_ID });
    expect(res.statusCode).toBe(202);
    expect((published[0]!.msg.payload as Record<string, unknown>)).toMatchObject({ payee: "Asha Verma (E-1001)", payeeId: EMPLOYEE_ID, type: "employee" });
  });

  it("a payee of type other cannot carry an id (400 with a field error)", async () => {
    const published = spyPublish();
    const res = await create({ type: "other", payee: "Local panchayat", payeeId: randomUUID() });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "ADVANCE_PAYEE_ID_NOT_ALLOWED", fieldErrors: [{ field: "payeeId" }] });
    expect(published).toHaveLength(0);
  });

  it("a payeeId that is not a uuid is rejected by the schema (400)", async () => {
    const res = await create({ type: "employee", payee: "Asha", payeeId: "E-1001" });
    expect(res.statusCode).toBe(400);
    expect(res.json().fieldErrors).toEqual([expect.objectContaining({ field: "payeeId" })]);
  });

  it("no payeeId at all still works exactly as before (typed payee, 202)", async () => {
    expect((await create({ type: "other", payee: "Local panchayat" })).statusCode).toBe(202);
  });

  it("the role gate is unchanged: a non-finance role is 403 before any lookup", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/finance/advances", headers: bearer(T, ACTOR, ["procurement_officer"]), payload: { ...BASE, advanceNo: "ADV-PP-403", type: "vendor", payee: "x", payeeId: VENDOR } });
    expect(res.statusCode).toBe(403);
  });
});

describe("payee_id is stored by the consumer and never returned by the register", () => {
  it("the picked id lands in finance_advances.payee_id; an advance without one stores NULL", async () => {
    const withId = randomUUID();
    const without = randomUUID();
    const base = { tenantId: T, actorId: ACTOR, correlationId: "corr-pp-store", schemaVersion: "1.0" };
    const payload = (id: string, extra: Record<string, unknown>) => ({ id, tenantId: T, advanceNo: `ADV-ST-${id.slice(0, 8)}`, purpose: "p", payee: "Asha Verma (E-1001)", type: "employee", amountMinor: 1000, currency: "INR", ...extra });
    await consume({ topic: COMMANDS.advanceCreate, msg: { messageId: randomUUID(), type: COMMANDS.advanceCreate, ...base, payload: payload(withId, { payeeId: EMPLOYEE_ID }) } });
    await consume({ topic: COMMANDS.advanceCreate, msg: { messageId: randomUUID(), type: COMMANDS.advanceCreate, ...base, payload: payload(without, {}) } });
    const [a] = await scoped(T, (tx) => tx.select().from(financeAdvances).where(eq(financeAdvances.id, withId)));
    const [b] = await scoped(T, (tx) => tx.select().from(financeAdvances).where(eq(financeAdvances.id, without)));
    expect(a?.payeeId).toBe(EMPLOYEE_ID);
    expect(b?.payeeId).toBeNull();

    // the register shows the name, but NOT the id, to anyone
    for (const roles of [["finance_officer"], ["procurement_officer"], ["audit_officer"]]) {
      const res = await app.inject({ method: "GET", url: "/v1/finance/advances?limit=100", headers: bearer(T, ACTOR, roles) });
      expect(res.statusCode).toBe(200);
      expect(JSON.stringify(res.json())).not.toContain(EMPLOYEE_ID);
      for (const row of res.json() as Array<Record<string, unknown>>) expect(row).not.toHaveProperty("payeeId");
    }
  });
});

describe("the free-text reason is masked with the name (ADVANCES-03)", () => {
  it("pure: reason is masked on employee rows for a non-entitled role, left on vendor rows and for entitled roles", () => {
    const rows = [
      { type: "employee", beneficiary: "Asha Verma", purpose: "Tour", reason: "Sanctioned for Asha Verma's tour" },
      { type: "vendor", beneficiary: "Acme", purpose: "Mobilisation", reason: "Per work order 7" },
    ];
    const masked = maskAdvanceBeneficiaries(rows, ["procurement_officer"]);
    expect(masked[0]).toEqual({ type: "employee", beneficiary: "A*** V***", purpose: "***", reason: "***" });
    expect(masked[1]).toEqual(rows[1]);
    for (const role of ["finance_officer", "finance_admin", "super_admin", "audit_officer"]) {
      expect(maskAdvanceBeneficiaries(rows, [role])).toBe(rows);
    }
  });

  it("HTTP: procurement_officer sees *** for an employee advance's reason, finance_officer sees it", async () => {
    // a tenant of its own: the register list is cached per tenant for 60 s, and T's list was already read above
    const tenant = randomUUID();
    const id = randomUUID();
    await scoped(tenant, (tx) => tx.insert(financeAdvances).values({
      id, tenantId: tenant, advanceNo: `ADV-RS-${id.slice(0, 8)}`, beneficiary: "Asha Verma", type: "employee", amountMinor: 100000n,
      purpose: "Tour advance", reason: "Sanctioned for Asha Verma's tour", createdBy: ACTOR, updatedBy: ACTOR,
    }));
    const as = async (roles: string[]) => {
      const res = await app.inject({ method: "GET", url: "/v1/finance/advances?limit=100", headers: bearer(tenant, ACTOR, roles) });
      return (res.json() as Array<{ id: string; beneficiary: string; purpose?: string; reason?: string }>).find((r) => r.id === id)!;
    };
    expect(await as(["procurement_officer"])).toMatchObject({ beneficiary: "A*** V***", purpose: "***", reason: "***" });
    expect(await as(["finance_officer"])).toMatchObject({ beneficiary: "Asha Verma", purpose: "Tour advance", reason: "Sanctioned for Asha Verma's tour" });
  });
});
