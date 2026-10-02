/**
 * masters/consumer.ts fiscal-year handlers (GAP-FINANCE-FISCAL-YEARS-01/-02):
 *  - activate never closes the current year when the target code is unknown;
 *  - the stated reason is recorded on the audit event.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const h = vi.hoisted(() => {
  const state: { years: Array<{ code: string; status: string; startDate?: string; endDate?: string }> } = { years: [] };
  const updates: unknown[] = [];
  const tx = {
    execute: vi.fn(async () => []),
    select: vi.fn(() => ({ from: () => ({ where: async () => state.years }) })),
    update: vi.fn(() => ({ set: (v: unknown) => ({ where: async () => { updates.push(v); } }) })),
    insert: vi.fn(() => ({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [{ id: "x" }] }) }) })),
  };
  return {
    state, updates, tx,
    enqueue: vi.fn(async () => undefined),
    transaction: vi.fn(async (cb: (t: unknown) => Promise<void>) => { await cb(tx); }),
  };
});

vi.mock("../src/shared/db.js", () => ({ db: { transaction: h.transaction } }));
vi.mock("../src/shared/outbox.js", () => ({ enqueue: h.enqueue, markProcessed: vi.fn(async () => true) }));
vi.mock("../src/shared/infra.js", () => ({ cache: { invalidate: vi.fn(), invalidateResource: vi.fn(async () => undefined) } }));

import { registerMastersConsumers } from "../src/modules/masters/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-0000000a1fc1";
const settle = () => new Promise<void>((r) => setTimeout(r, 150));
const msg = (type: string, payload: Record<string, unknown>) => ({
  messageId: randomUUID(), type, tenantId: TENANT, actorId: randomUUID(), correlationId: randomUUID(), schemaVersion: "1.0", payload,
});

beforeEach(() => { h.updates.length = 0; h.enqueue.mockClear(); });

describe("fiscal-year consumer", () => {
  it("activate of an unknown code closes nothing and dead-letters", async () => {
    h.state.years = [{ code: "2026-27", status: "active" }];
    const q = new MemoryQueue({ maxAttempts: 1 });
    registerMastersConsumers(q);
    await q.publish(COMMANDS.fiscalYearActivate, msg(COMMANDS.fiscalYearActivate, { id: randomUUID(), tenantId: TENANT, code: "2099-00", reason: "unknown code" }));
    await settle();
    expect(h.updates).toHaveLength(0);
    expect(h.enqueue).not.toHaveBeenCalled();
    expect(q.dlq.length).toBe(1);
  });

  it("activate records the reason and the closed year on the audit event", async () => {
    h.state.years = [{ code: "2026-27", status: "active" }, { code: "2025-26", status: "closed" }];
    const q = new MemoryQueue({ maxAttempts: 1 });
    registerMastersConsumers(q);
    await q.publish(COMMANDS.fiscalYearActivate, msg(COMMANDS.fiscalYearActivate, { id: randomUUID(), tenantId: TENANT, code: "2025-26", reason: "Re-open prior year for audit" }));
    await settle();
    const audit = (h.enqueue.mock.calls as unknown as Array<[unknown, { payload: Record<string, unknown> }]>)
      .map((c) => c[1].payload).find((p) => p.action === "activate_fiscal_year");
    expect(audit).toMatchObject({ reason: "Re-open prior year for audit", closedFiscalYears: ["2026-27"], resourceId: "2025-26" });
  });

  it("create rejects an overlapping range inside the transaction (racing create)", async () => {
    h.state.years = [{ code: "2026-27", status: "active", startDate: "2026-04-01", endDate: "2027-03-31" }];
    const q = new MemoryQueue({ maxAttempts: 1 });
    registerMastersConsumers(q);
    await q.publish(COMMANDS.fiscalYearCreate, msg(COMMANDS.fiscalYearCreate, {
      id: randomUUID(), tenantId: TENANT, code: "2027-28", label: "x", startDate: "2027-03-01", endDate: "2028-02-28", reason: "overlap",
    }));
    await settle();
    expect(h.tx.insert).not.toHaveBeenCalled();
    expect(q.dlq.length).toBe(1);
  });
});
