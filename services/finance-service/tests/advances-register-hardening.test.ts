/**
 * finance-service — advances register hardening (ml-finance-04):
 *  - GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-02: a duplicate advance number is a
 *    synchronous 409 with a field-level error, not a silent async failure.
 *  - GAP-FINANCE-EXPENDITURE-ADVANCES-03: personal-advance names are masked
 *    for roles that are not entitled to see them (DPDP).
 *  - GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-06: the stated purpose is returned,
 *    distinct from the advance `type`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { scoped } from "./_tenant.js";
import { financeAdvances } from "../src/modules/payments/schema.js";
import { maskPersonName, maskAdvanceBeneficiaries } from "../src/modules/payments/domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000088";
const ACTOR = "00000000-aaaa-4000-8000-000000000088";
const EMP_ID = "14141414-aaaa-4000-8000-000000000001";
const VEN_ID = "14141414-aaaa-4000-8000-000000000002";

const token = (roles: string[]) => signToken({ sub: "user-088", tid: TENANT, roles, sid: "sess-088" }, SECRET);

async function wipe() {
  await scoped(TENANT, (tx) => tx.delete(financeAdvances).where(eq(financeAdvances.tenantId, TENANT)));
}

afterAll(async () => { await wipe(); await sqlClient.end(); });

describe("maskPersonName / maskAdvanceBeneficiaries (pure)", () => {
  it("keeps only the first letter of each name part", () => {
    expect(maskPersonName("Asha Verma")).toBe("A*** V***");
    expect(maskPersonName("  ")).toBe("***");
  });
  it("masks only employee advances, and only for roles outside the entitled set", () => {
    const rows = [
      { type: "employee", beneficiary: "Asha Verma" },
      { type: "vendor", beneficiary: "Acme Traders" },
    ];
    expect(maskAdvanceBeneficiaries(rows, ["procurement_officer"])).toEqual([
      { type: "employee", beneficiary: "A*** V***" },
      { type: "vendor", beneficiary: "Acme Traders" },
    ]);
    expect(maskAdvanceBeneficiaries(rows, ["finance_officer"])).toBe(rows);
    expect(maskAdvanceBeneficiaries(rows, ["audit_officer"])).toBe(rows);
    expect(maskAdvanceBeneficiaries(rows, [])[0]?.beneficiary).toBe("A*** V***");
  });
});

describe("advances register over HTTP", () => {
  beforeAll(async () => {
    await wipe();
    await scoped(TENANT, async (tx) => {
      await tx.insert(financeAdvances).values([
        { id: EMP_ID, tenantId: TENANT, advanceNo: "ADV-DUP-1", beneficiary: "Asha Verma", type: "employee", amountMinor: 100000n, purpose: "Tour advance", createdBy: ACTOR, updatedBy: ACTOR },
        { id: VEN_ID, tenantId: TENANT, advanceNo: "ADV-DUP-2", beneficiary: "Acme Traders", type: "vendor", amountMinor: 200000n, purpose: "Mobilisation", createdBy: ACTOR, updatedBy: ACTOR },
      ]);
    });
  });

  it("rejects a duplicate advance number with 409 and a field-level error", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/finance/advances",
      headers: { authorization: `Bearer ${token(["finance_officer"])}`, "content-type": "application/json" },
      payload: { advanceNo: "ADV-DUP-1", purpose: "Again", payee: "X", amountMinor: "1000" },
    });
    await app.close();
    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.code).toBe("DUPLICATE_ADVANCE_NO");
    expect(body.fieldErrors).toEqual([expect.objectContaining({ field: "advanceNo" })]);
  });

  it("still accepts a fresh advance number (202)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/finance/advances",
      headers: { authorization: `Bearer ${token(["finance_officer"])}`, "content-type": "application/json" },
      payload: { advanceNo: "ADV-FRESH-1", purpose: "New", payee: "X", amountMinor: "1000" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("returns the purpose alongside the type, and the full name to a finance officer", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/finance/advances", headers: { authorization: `Bearer ${token(["finance_officer"])}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
    const rows = res.json() as { id: string; beneficiary: string; type: string; purpose?: string }[];
    const emp = rows.find((r) => r.id === EMP_ID);
    expect(emp).toMatchObject({ beneficiary: "Asha Verma", type: "employee", purpose: "Tour advance" });
  });

  it("masks the officer name (not the vendor) for procurement_officer", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/finance/advances", headers: { authorization: `Bearer ${token(["procurement_officer"])}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
    const rows = res.json() as { id: string; beneficiary: string }[];
    expect(rows.find((r) => r.id === EMP_ID)?.beneficiary).toBe("A*** V***");
    expect(rows.find((r) => r.id === VEN_ID)?.beneficiary).toBe("Acme Traders");
  });
});

// ── review follow-ups (PR #1805) ─────────────────────────────────────────────
import { MemoryQueue } from "@civitasone/queue";
import { registerPaymentsConsumers } from "../src/modules/payments/consumer.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { financeBills } from "../src/modules/payments/schema.js";
import { financeHeads } from "../src/modules/budget/schema.js";
import { assertPayerNotPasser, DomainError } from "../src/modules/payments/domain.js";
import { COMMANDS } from "../src/topics.js";

describe("purpose is masked with the name, and payee is required", () => {
  it("masks purpose on employee rows for a non-entitled role (it can name the person)", () => {
    const rows = [
      { type: "employee", beneficiary: "Asha Verma", purpose: "Tour advance for Asha Verma" },
      { type: "vendor", beneficiary: "Acme", purpose: "Mobilisation" },
    ];
    const out = maskAdvanceBeneficiaries(rows, ["procurement_officer"]);
    expect(out[0]).toEqual({ type: "employee", beneficiary: "A*** V***", purpose: "***" });
    expect(out[1]?.purpose).toBe("Mobilisation");
  });

  it("rejects a create without payee (no purpose fallback) with 400", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST", url: "/v1/finance/advances",
      headers: { authorization: `Bearer ${token(["finance_officer"])}`, "content-type": "application/json" },
      payload: { advanceNo: "ADV-NOPAYEE", purpose: "Tour advance for Asha Verma", amountMinor: "1000" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
    expect(res.json().fieldErrors).toEqual([expect.objectContaining({ field: "payee" })]);
  });
});

describe("advance consumer: unique-violation race is a recorded failure, not a silent drop", () => {
  const IDS = ["15151515-aaaa-4000-8000-000000000001", "15151515-aaaa-4000-8000-000000000002", "15151515-aaaa-4000-8000-000000000003"];
  const MSGS = ["15151515-bbbb-4000-8000-000000000001", "15151515-bbbb-4000-8000-000000000002", "15151515-bbbb-4000-8000-000000000003"];

  async function cleanRace() {
    await scoped(TENANT, (tx) => tx.delete(outboxMessages).where(eq(outboxMessages.correlationId, "corr-adv-race")));
    for (const m of MSGS) await db.delete(processed).where(eq(processed.messageId, m));
    await wipe();
  }
  afterAll(cleanRace);

  it("second create with the same number audits outcome=failure and does not retry or throw", async () => {
    await cleanRace();
    const q = new MemoryQueue({ maxAttempts: 1 });
    registerPaymentsConsumers(q);
    await q.start();
    const base = { tenantId: TENANT, actorId: ACTOR, correlationId: "corr-adv-race", schemaVersion: "1.0" };
    const payload = (id: string) => ({ id, tenantId: TENANT, advanceNo: "ADV-RACE", purpose: "p", payee: "Asha Verma", type: "employee", amountMinor: 1000, currency: "INR" });
    await q.publish("finance.advance.create", { messageId: MSGS[0]!, type: "finance.advance.create", ...base, payload: payload(IDS[0]!) });
    await q.drain();
    await q.publish("finance.advance.create", { messageId: MSGS[1]!, type: "finance.advance.create", ...base, payload: payload(IDS[1]!) });
    await q.drain();
    await q.stop();

    expect(q.dlq.length).toBe(0);
    const rows = await scoped(TENANT, (tx) => tx.select().from(financeAdvances).where(eq(financeAdvances.advanceNo, "ADV-RACE")));
    expect(rows).toHaveLength(1);
    const outbox = await scoped(TENANT, (tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.correlationId, "corr-adv-race")));
    const failure = outbox.find((r) => (r.payload as { action?: string }).action === "create_rejected_duplicate_advance_no");
    expect(failure).toBeDefined();
    expect((failure!.payload as { outcome?: string }).outcome).toBe("failure");
  });

  it("a queued message with no payee is rejected, never back-filled from purpose", async () => {
    await cleanRace();
    const q = new MemoryQueue({ maxAttempts: 1 });
    registerPaymentsConsumers(q);
    await q.start();
    await q.publish("finance.advance.create", {
      messageId: MSGS[2]!, type: "finance.advance.create", tenantId: TENANT, actorId: ACTOR, correlationId: "corr-adv-race", schemaVersion: "1.0",
      payload: { id: IDS[2]!, tenantId: TENANT, advanceNo: "ADV-NOPAYEE-Q", purpose: "Tour for Asha Verma", type: "employee", amountMinor: 1000 },
    });
    await q.drain();
    await q.stop();
    expect(q.dlq.length).toBe(1);
    const rows = await scoped(TENANT, (tx) => tx.select().from(financeAdvances).where(eq(financeAdvances.id, IDS[2]!)));
    expect(rows).toHaveLength(0);
  });
});

describe("passer != payer", () => {
  const PASSER = "00000000-cccc-4000-8000-000000000088";
  const CREATOR = "00000000-dddd-4000-8000-000000000088";
  const PAYER = "00000000-eeee-4000-8000-000000000088";
  const HEAD = "16161616-bbbb-4000-8000-000000000001";
  const BILL = "16161616-cccc-4000-8000-000000000001";
  const MSG = "16161616-dddd-4000-8000-000000000001";

  it("domain: only a passed bill and an identical actor trips it", () => {
    expect(() => assertPayerNotPasser("passed", PASSER, PASSER)).toThrow(DomainError);
    expect(() => assertPayerNotPasser("passed", PASSER, PAYER)).not.toThrow();
    expect(() => assertPayerNotPasser("pending", PASSER, PASSER)).not.toThrow();
  });

  async function seed() {
    await scoped(TENANT, (tx) => tx.insert(financeHeads).values({ id: HEAD, tenantId: TENANT, code: "4800-PP", name: "Passer Payer Head", level: 2, createdBy: CREATOR, updatedBy: CREATOR }).onConflictDoNothing());
    await scoped(TENANT, (tx) => tx.insert(financeBills).values({
      id: BILL, tenantId: TENANT, billNo: "BILL-PP-1", vendorId: "16161616-aaaa-4000-8000-000000000001", headId: HEAD,
      grossMinor: 500000n, netMinor: 500000n, currency: "INR", deductions: [], stage: "pay", status: "passed", createdBy: CREATOR, updatedBy: PASSER,
    }));
  }
  async function cleanPP() {
    await scoped(TENANT, (tx) => tx.delete(outboxMessages).where(eq(outboxMessages.correlationId, "corr-pp")));
    await db.delete(processed).where(eq(processed.messageId, MSG));
    await scoped(TENANT, (tx) => tx.delete(financeBills).where(eq(financeBills.id, BILL)));
  }
  afterAll(cleanPP);

  it("route: 409 PAYER_IS_PASSER for the passer, no 409 for a different payer", async () => {
    await cleanPP(); await seed();
    const app = await buildApp();
    const pay = (sub: string) => app.inject({
      method: "POST", url: "/v1/finance/payments/eft",
      headers: { authorization: `Bearer ${signToken({ sub, tid: TENANT, roles: ["finance_officer"], sid: "s" }, SECRET)}`, "content-type": "application/json" },
      payload: { billId: BILL, ddoCode: "DDO123", mode: "NEFT", amountMinor: "500000" },
    });
    const same = await pay(PASSER);
    expect(same.statusCode).toBe(409);
    expect(same.json().code).toBe("PAYER_IS_PASSER");
    const other = await pay(PAYER);
    expect(other.statusCode).not.toBe(409);
    await app.close();
  });

  it("consumer: authoritative, rejects the passer as payer and leaves the bill unpaid", async () => {
    await cleanPP(); await seed();
    const q = new MemoryQueue({ maxAttempts: 1 });
    registerPaymentsConsumers(q);
    await q.start();
    await q.publish(COMMANDS.paymentInitiate, {
      messageId: MSG, type: COMMANDS.paymentInitiate, tenantId: TENANT, actorId: PASSER, correlationId: "corr-pp", schemaVersion: "1.0",
      payload: { id: "16161616-eeee-4000-8000-000000000001", billId: BILL, tenantId: TENANT, ddoCode: "DDO123", mode: "NEFT", amountMinor: 500000 },
    });
    await q.drain();
    await q.stop();
    expect(q.dlq.length).toBe(1);
    expect(q.dlq[0]?.error).toMatch(/PAYER_IS_PASSER/);
    const rows = await scoped(TENANT, (tx) => tx.select().from(financeBills).where(eq(financeBills.id, BILL)));
    expect(rows[0]?.status).toBe("passed");
  });
});
