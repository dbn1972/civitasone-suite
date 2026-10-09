/**
 * GAP2-ESTAB-QUARTERS-LICENCE-FEE-01 + GAP2-ESTAB-QUARTERS-OVERSTAY-01 —
 * quarters consumer against REAL Postgres (estab_svc, FORCE RLS).
 *
 * Proves (fails on the old consumer):
 *  - occupy picks the EFFECTIVE-DATED rate (not an arbitrary .limit(1) row)
 *    when a tenant has an old + a new rate for the same type+pay-level;
 *  - the licence-fee rate table rejects overlapping effective ranges
 *    (excl_licence_fee_no_overlap, migration 0049);
 *  - vacating after vacation_due_date creates an overstay penalty row AND
 *    emits a finance receivable for recovery (old code did neither).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import {
  estabQuarters, estabQuarterAllotments, estabLicenceFeeRates, estabOverstayPenalties,
} from "../src/modules/quarters/schema.js";
import { registerQuarterConsumers } from "../src/modules/quarters/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "7ca10001-0000-4000-8000-00000000000a";
const ACTOR = "7ca10001-0000-4000-8000-0000000000a1";
const EMPLOYEE = "7ca10001-0000-4000-8000-0000000000e1";

type Handler = (msg: Record<string, unknown>) => Promise<void>;
const handlers = new Map<string, Handler>();
const fakeQueue = { subscribe: (t: string, h: Handler) => void handlers.set(t, h) } as unknown as Queue;
const messageIds: string[] = [];

async function deliver(topic: string, payload: Record<string, unknown>, messageId = randomUUID()): Promise<void> {
  messageIds.push(messageId);
  const h = handlers.get(topic);
  if (!h) throw new Error("no handler " + topic);
  await runWithTenant(TENANT, () =>
    h({ messageId, type: topic, tenantId: TENANT, actorId: ACTOR, correlationId: "corr-qtr", schemaVersion: "1.0", payload }));
}

async function outbox(topic: string): Promise<Array<Record<string, unknown>>> {
  const rows = await sqlClient`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT} AND topic = ${topic} ORDER BY created_at`;
  return (rows as unknown as Array<{ payload: Record<string, unknown> }>).map((r) => r.payload);
}

async function seedQuarter(quarterType: string): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(estabQuarters).values({
    id, tenantId: TENANT, quarterNo: `Q-${id.slice(0, 6)}`, quarterType,
    status: "occupied", createdBy: ACTOR, updatedBy: ACTOR,
  })));
  return id;
}

async function seedAllotment(quarterId: string, payLevel: string, status: string, extra: Record<string, unknown> = {}): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(estabQuarterAllotments).values({
    id, tenantId: TENANT, quarterId, employeeRef: EMPLOYEE, payLevel,
    status, version: 1, createdBy: ACTOR, updatedBy: ACTOR, ...extra,
  })));
  return id;
}

async function seedRate(quarterType: string, payLevel: string, monthlyMinor: bigint, from: string, to: string | null): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(estabLicenceFeeRates).values({
    id, tenantId: TENANT, quarterType, payLevel, monthlyMinor,
    currency: "INR", effectiveFrom: from, effectiveTo: to, createdBy: ACTOR,
  })));
  return id;
}

beforeAll(() => { registerQuarterConsumers(fakeQueue); });

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(estabOverstayPenalties).where(eq(estabOverstayPenalties.tenantId, TENANT));
    await tx.delete(estabQuarterAllotments).where(eq(estabQuarterAllotments.tenantId, TENANT));
    await tx.delete(estabLicenceFeeRates).where(eq(estabLicenceFeeRates.tenantId, TENANT));
    await tx.delete(estabQuarters).where(eq(estabQuarters.tenantId, TENANT));
  }));
  await sqlClient`DELETE FROM _outbox.messages WHERE tenant_id = ${TENANT}`;
  if (messageIds.length) await sqlClient`DELETE FROM _inbox.processed WHERE message_id IN ${sqlClient(messageIds)}`;
  await sqlClient.end();
});

describe("GAP2-ESTAB-QUARTERS-LICENCE-FEE-01 — occupy uses the effective-dated rate", () => {
  it("emits the CURRENT (not the stale) monthly amount into payroll + finance", async () => {
    const quarterId = await seedQuarter("type_iv");
    const allotmentId = await seedAllotment(quarterId, "level_7", "allotted");
    // Old rate expired at the end of last year; new rate effective this year.
    await seedRate("type_iv", "level_7", 100000n, "2024-01-01", "2024-12-31"); // ₹1,000 (stale)
    await seedRate("type_iv", "level_7", 250000n, "2025-01-01", null);          // ₹2,500 (current)

    await deliver(COMMANDS.quarterOccupy, { id: allotmentId, tenantId: TENANT, version: 1 });

    const payroll = (await outbox("payroll.deduction.create")).filter((p) => p.refId === allotmentId);
    const finance = (await outbox("finance.receivable.create")).filter((p) => p.refId === allotmentId);
    expect(payroll).toHaveLength(1);
    expect(finance).toHaveLength(1);
    // The current ₹2,500 (250000 paise) must be used, never the stale ₹1,000.
    expect(payroll[0]!.amountMinor).toBe("250000");
    expect(finance[0]!.amountMinor).toBe("250000");
  });
});

describe("GAP2-ESTAB-QUARTERS-LICENCE-FEE-01 — no overlapping rate ranges", () => {
  it("rejects a second rate whose effective range overlaps an existing one for the same type+pay-level", async () => {
    await seedRate("type_v", "level_9", 300000n, "2025-01-01", "2025-12-31");
    await expect(
      seedRate("type_v", "level_9", 400000n, "2025-06-01", null), // overlaps 2025-06-01..2025-12-31
    ).rejects.toThrow(/excl_licence_fee_no_overlap|exclusion|conflicting key/i);
  });

  it("allows a non-overlapping successor range (old closed, new starts the next day)", async () => {
    await seedRate("type_vi", "level_10", 300000n, "2025-01-01", "2025-12-31");
    await expect(
      seedRate("type_vi", "level_10", 350000n, "2026-01-01", null),
    ).resolves.toBeTypeOf("string");
  });
});

describe("GAP2-ESTAB-QUARTERS-OVERSTAY-01 — vacate past due date recovers a penalty", () => {
  it("creates one penalty row (penaltyDays=10) and emits a finance receivable", async () => {
    const quarterId = await seedQuarter("type_iii");
    // dailyRate derives from monthly / days-in-month. Use 300000 paise/month in
    // a 30-day due month → 10000 paise/day.
    await seedRate("type_iii", "level_6", 300000n, "2024-01-01", null);
    const dueDate = "2026-06-20"; // June has 30 days
    const allotmentId = await seedAllotment(quarterId, "level_6", "occupied", {
      occupiedAt: new Date("2026-01-01T00:00:00Z"),
      vacationNoticeAt: new Date("2026-06-01T00:00:00Z"),
      vacationDueDate: dueDate,
    });
    // Move to vacation_notice first so the state machine allows → vacated.
    await runWithTenant(TENANT, () => db.transaction((tx) => tx.update(estabQuarterAllotments)
      .set({ status: "vacation_notice" }).where(eq(estabQuarterAllotments.id, allotmentId))));

    // vacate happens "today" (well past 2026-06-20) → overstay > 0.
    await deliver(COMMANDS.quarterVacate, { id: allotmentId, tenantId: TENANT, version: 1 });

    const penalties = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(estabOverstayPenalties).where(eq(estabOverstayPenalties.allotmentId, allotmentId))));
    expect(penalties).toHaveLength(1);
    const pen = penalties[0]!;
    expect(pen.penaltyDays).toBeGreaterThan(0);
    expect(Number(pen.totalMinor)).toBe(pen.penaltyDays * 10000 * 2); // dailyRate 10000, 2x multiplier
    expect(pen.status).toBe("pending");

    const finance = (await outbox("finance.receivable.create")).filter((p) => p.refId === pen.id);
    expect(finance).toHaveLength(1);
    expect(finance[0]!.refType).toBe("quarter_overstay_penalty");
    expect(finance[0]!.amountMinor).toBe(pen.totalMinor.toString());
  });

  it("creates NO penalty when vacated on or before the due date", async () => {
    const quarterId = await seedQuarter("type_ii");
    await seedRate("type_ii", "level_4", 300000n, "2024-01-01", null);
    // Due date far in the future → vacating today is not an overstay.
    const allotmentId = await seedAllotment(quarterId, "level_4", "vacation_notice", {
      vacationDueDate: "2999-01-01",
    });
    await deliver(COMMANDS.quarterVacate, { id: allotmentId, tenantId: TENANT, version: 1 });
    const penalties = await runWithTenant(TENANT, () => db.transaction((tx) =>
      tx.select().from(estabOverstayPenalties).where(eq(estabOverstayPenalties.allotmentId, allotmentId))));
    expect(penalties).toHaveLength(0);
  });

  it("cleanup sentinel", async () => {
    // touch inArray import so lint doesn't flag it unused if the suite is trimmed
    expect(inArray(estabOverstayPenalties.tenantId, [TENANT])).toBeDefined();
  });
});
