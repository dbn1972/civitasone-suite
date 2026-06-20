/**
 * payroll-service test suite
 *
 * Test 1 — Payroll calc (pure): basic + HRA + DA - PF - TDS = net.
 * Test 2 — PF ceiling (pure): PF capped at 15000 INR basic.
 * Test 3 — TDS slab (pure): annual basic <= 500000 → TDS = 0.
 * Test 4 — Payroll run state machine (pure): valid/invalid transitions.
 * Test 5 — CQRS: POST /payroll/runs → queue → consumer → DB (MemoryQueue).
 * Test 6 — Payroll run approve: status → approved + event emitted.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { MemoryQueue } from "@civitasone/queue";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { payrollRuns } from "../src/modules/payroll/schema.js";
import { outboxMessages, processed } from "../src/shared/outbox.js";
import { registerPayrollConsumers } from "../src/modules/payroll/consumer.js";
import {
  computeSlip,
  assertRunStatusTransition,
  computeGratuity,
} from "../src/modules/payroll/domain.js";
import { EVENTS } from "../src/topics.js";

const ACTOR   = "00000000-aaaa-4000-8000-000000000002";
const TENANT  = "11111111-aaaa-4000-8000-000000000022";
const RUN_1   = "22222222-bbbb-4000-8000-000000000022";
const RUN_2   = "33333333-cccc-4000-8000-000000000022";
const STRUCT_1 = "44444444-dddd-4000-8000-000000000022";
const MSG_1   = "55555555-eeee-4000-8000-000000000022";
const MSG_2   = "66666666-ffff-4000-8000-000000000022";
const MSG_APR = "77777777-aaaa-4000-8000-000000000022";

async function wipeTestData() {
  await db.delete(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
  await db.delete(payrollRuns).where(eq(payrollRuns.tenantId, TENANT));
  await db.delete(processed).where(eq(processed.messageId, MSG_1));
  await db.delete(processed).where(eq(processed.messageId, MSG_2));
  await db.delete(processed).where(eq(processed.messageId, MSG_APR));
}

// ── 1. Payroll computation (pure) ────────────────────────────────

describe("Payroll domain — slip calculation (pure)", () => {
  it("basic + HRA + DA - PF - TDS = net", () => {
    // Basic: 30000 INR = 3000000 paise
    // HRA: 15000 INR = 1500000 paise (earning)
    // DA: 6000 INR = 600000 paise (earning)
    const basic = 3_000_000n;
    const result = computeSlip({
      basicMinor: basic,
      components: [
        { code: "HRA", name: "HRA", type: "earning",   amountMinor: 1_500_000n },
        { code: "DA",  name: "DA",  type: "earning",   amountMinor:   600_000n },
      ],
    });

    expect(result.grossMinor).toBe(5_100_000n); // 30000 + 15000 + 6000
    // PF is capped at 15000 INR basic (1500000 paise), so PF = 12% of 1500000 = 180000
    const pfEmployee = (1_500_000n * 12n) / 100n; // 180000 paise = 1800 INR
    expect(result.pfEmployeeMinor).toBe(pfEmployee);
    expect(result.pfEmployerMinor).toBe(pfEmployee);
    expect(result.tdsMinor).toBe(0n); // annual basic 360000 INR < 500000 INR threshold
    // Gross = 51000 INR > ESI ceiling of 21000 INR → ESI not applicable
    expect(result.esiMinor).toBe(0n);
    expect(result.netPayMinor).toBe(result.grossMinor - pfEmployee - 0n);
  });

  it("deduction component reduces net pay", () => {
    const basic = 2_000_000n;
    const result = computeSlip({
      basicMinor: basic,
      components: [{ code: "LOP", name: "LOP", type: "deduction", amountMinor: 200_000n }],
    });
    expect(result.totalDeductionsMinor).toBeGreaterThan(200_000n); // includes PF + ESI
    expect(result.netPayMinor).toBeGreaterThan(0n);
  });
});

// ── 2. PF ceiling ─────────────────────────────────────────────────

describe("Payroll domain — PF ceiling (pure)", () => {
  it("PF is capped at 15000 INR (1500000 paise) when basic exceeds cap", () => {
    const bigBasic = 5_000_000n; // 50000 INR
    const result = computeSlip({ basicMinor: bigBasic, components: [] });
    expect(result.pfEmployeeMinor).toBe((1_500_000n * 12n) / 100n); // 180000 paise = 1800 INR
  });

  it("PF is 12% of basic when basic is below cap", () => {
    const smallBasic = 1_000_000n; // 10000 INR
    const result = computeSlip({ basicMinor: smallBasic, components: [] });
    expect(result.pfEmployeeMinor).toBe(120_000n); // 1200 INR
  });
});

// ── 3. TDS slab ───────────────────────────────────────────────────

describe("Payroll domain — TDS (pure)", () => {
  it("no TDS when annual basic <= 500000 INR", () => {
    const basic = 4_000_000n; // 40000 INR/month = 480000 annual → below 500000
    const result = computeSlip({ basicMinor: basic, components: [] });
    expect(result.tdsMinor).toBe(0n);
  });

  it("TDS is 10% of excess above 500000 annual, divided by 12", () => {
    const basic = 6_000_000n; // 60000 INR/month = 720000 annual → excess = 220000
    const result = computeSlip({ basicMinor: basic, components: [] });
    const annualExcess = 6_000_000n * 12n - 50_000_000n; // 72M - 50M = 22M paise
    const expectedMonthlyTds = (annualExcess * 10n) / 100n / 12n;
    expect(result.tdsMinor).toBe(expectedMonthlyTds);
  });
});

// ── 4. Run state machine (pure) ───────────────────────────────────

describe("Payroll run — state machine (pure)", () => {
  it("draft → processing is valid", () => {
    expect(() => assertRunStatusTransition("draft", "processing")).not.toThrow();
  });

  it("processing → approved is valid", () => {
    expect(() => assertRunStatusTransition("processing", "approved")).not.toThrow();
  });

  it("approved → disbursed is valid", () => {
    expect(() => assertRunStatusTransition("approved", "disbursed")).not.toThrow();
  });

  it("disbursed → approved is invalid", () => {
    expect(() => assertRunStatusTransition("disbursed", "approved")).toThrowError("INVALID_STATUS_TRANSITION");
  });

  it("approved → draft is invalid", () => {
    expect(() => assertRunStatusTransition("approved", "draft")).toThrowError("INVALID_STATUS_TRANSITION");
  });
});

// ── 5. Gratuity (pure) ────────────────────────────────────────────

describe("Payroll domain — gratuity (pure)", () => {
  it("gratuity is zero below 5 years", () => {
    expect(computeGratuity(4, 3_000_000n)).toBe(0n);
  });

  it("gratuity = (basic / 26) * 15 * years for 10 years", () => {
    const basic = 3_000_000n;
    const expected = (basic * 15n * 10n) / 26n;
    expect(computeGratuity(10, basic)).toBe(expected);
  });
});

// ── 6. CQRS — payroll run create ─────────────────────────────────

describe("Payroll run consumer — CQRS (integration)", () => {
  beforeAll(async () => { await wipeTestData(); });
  afterAll(async () => { await wipeTestData(); });

  it("run create command inserts run row with processing status", async () => {
    const q = new MemoryQueue();
    registerPayrollConsumers(q);
    await q.start();

    await q.publish("payroll.run.create", {
      messageId: MSG_1, type: "payroll.run.create",
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-run-1", schemaVersion: "1.0",
      payload: {
        id: RUN_1, tenantId: TENANT, runNo: "RUN-TEST-001", month: "2024-07",
        structureId: STRUCT_1, status: "draft",
      },
    });

    await new Promise<void>((r) => setTimeout(r, 600));
    await q.stop();

    const runs = await db.select().from(payrollRuns).where(eq(payrollRuns.id, RUN_1));
    expect(runs).toHaveLength(1);
    expect(runs[0]?.runNo).toBe("RUN-TEST-001");
    expect(runs[0]?.status).toBe("processing");

    const proc = await db.select().from(processed).where(eq(processed.messageId, MSG_1));
    expect(proc).toHaveLength(1);
  });
});

// ── 7. CQRS — approve run emits payroll.run.approved ─────────────

describe("Payroll run approve — event emitted (integration)", () => {
  beforeAll(async () => {
    await wipeTestData();
    await db.insert(payrollRuns).values({
      id: RUN_2, tenantId: TENANT, runNo: "RUN-TEST-002", month: "2024-08",
      structureId: STRUCT_1, totalGrossMinor: 0n, totalNetMinor: 0n,
      currency: "INR", status: "processing",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
  });

  afterAll(async () => {
    await wipeTestData();
    await sqlClient.end();
  });

  it("approve command sets status=approved and emits payroll.run.approved", async () => {
    const q = new MemoryQueue();
    registerPayrollConsumers(q);
    await q.start();

    await q.publish("payroll.run.approve", {
      messageId: MSG_APR, type: "payroll.run.approve",
      tenantId: TENANT, actorId: ACTOR, correlationId: "corr-approve-run-1", schemaVersion: "1.0",
      payload: { id: RUN_2, tenantId: TENANT, approvedBy: ACTOR },
    });

    await new Promise<void>((r) => setTimeout(r, 600));
    await q.stop();

    const runs = await db.select().from(payrollRuns).where(eq(payrollRuns.id, RUN_2));
    expect(runs[0]?.status).toBe("approved");
    expect(runs[0]?.approvedBy).toBe(ACTOR);

    const outbox = await db.select().from(outboxMessages).where(eq(outboxMessages.tenantId, TENANT));
    const eventTypes = outbox.map((r) => r.eventType);
    expect(eventTypes).toContain(EVENTS.runApproved);
    expect(eventTypes).toContain("audit.event.record");
  });
});
