/**
 * BoQ update/delete guards — quantity change blocked after measurement;
 * property-based recapitulation reconciliation.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as fc from "fast-check";
import { COMMANDS, EVENTS } from "../src/topics.js";
import { boqItems } from "../src/modules/boq/schema.js";
import { measurements } from "../src/modules/billing/schema.js";
import { calculateBoqAmount, calculateRecapitulation } from "../src/modules/boq/domain.js";
import { TENANT_A, ACTOR_A, queueMessage } from "./fixtures/works-fixtures.js";

const mockInserted: unknown[] = [];
const mockUpdated: unknown[] = [];
const mockDeleted: unknown[] = [];
const mockEnqueued: Array<{ topic: string }> = [];
const mockSelectMap = new Map<unknown, unknown[]>();
let mockMarkResult = true;

function chainRows(rows: unknown[]) {
  const w: any = Promise.resolve(rows);
  w.limit = () => Promise.resolve(rows);
  return w;
}

const mockTx: any = {
  insert: (t: unknown) => { mockInserted.push(t); return { values: () => Promise.resolve() }; },
  update: (t: unknown) => { mockUpdated.push(t); return { set: () => ({ where: () => Promise.resolve() }) }; },
  delete: (t: unknown) => { mockDeleted.push(t); return { where: () => Promise.resolve() }; },
  select: () => ({ from: (t: unknown) => ({ where: () => chainRows(mockSelectMap.get(t) ?? []) }) }),
};

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: (fn: Function) => fn(mockTx) },
  sqlClient: { end: vi.fn() },
  scopedRead: vi.fn((fn: Function) => fn(mockTx)),
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: { getOrLoad: vi.fn((_k: string, fn: Function) => fn()), invalidate: vi.fn() },
  queue: { publish: vi.fn(), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() },
}));
vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: vi.fn(() => Promise.resolve(mockMarkResult)),
  enqueue: vi.fn((_tx: unknown, ev: { topic: string }) => { mockEnqueued.push(ev); return Promise.resolve(); }),
  outboxMessages: {}, processed: {}, outboxSchema: {},
}));

beforeEach(() => {
  mockInserted.length = 0;
  mockUpdated.length = 0;
  mockDeleted.length = 0;
  mockEnqueued.length = 0;
  mockSelectMap.clear();
  mockMarkResult = true;
});

async function boqHandlers(): Promise<Record<string, Function>> {
  const { registerBoqConsumers } = await import("../src/modules/boq/consumer.js");
  const h: Record<string, Function> = {};
  registerBoqConsumers({ subscribe: (t: string, fn: Function) => { h[t] = fn; } } as any);
  return h;
}

describe("BoQ update quantity guard", () => {
  it("blocks quantity change when item is referenced by a measurement", async () => {
    mockSelectMap.set(boqItems, [{ id: "b-1", rate: 10000n, quantity: "10", workId: "w-1" }]);
    mockSelectMap.set(measurements, [{ id: "m-1", boqItemId: "b-1", quantity: "5" }]);
    const h = await boqHandlers();
    await h[COMMANDS.boqUpdateItem]({
      ...queueMessage(TENANT_A, ACTOR_A, "msg-boq-upd-1"),
      payload: { id: "b-1", quantity: 15 },
    });
    expect(mockUpdated).toHaveLength(0);
    expect(mockEnqueued.some((e) => e.topic === EVENTS.boqItemUpdated)).toBe(false);
  });

  it("allows description update without changing quantity when measurements exist", async () => {
    mockSelectMap.set(boqItems, [{ id: "b-1", rate: 10000n, quantity: "10", workId: "w-1" }]);
    mockSelectMap.set(measurements, [{ id: "m-1", boqItemId: "b-1" }]);
    const h = await boqHandlers();
    await h[COMMANDS.boqUpdateItem]({
      ...queueMessage(TENANT_A, ACTOR_A, "msg-boq-upd-2"),
      payload: { id: "b-1", itemDescription: "Revised description" },
    });
    expect(mockUpdated).toHaveLength(1);
    expect(mockEnqueued.some((e) => e.topic === EVENTS.boqItemUpdated)).toBe(true);
  });
});

describe("BoQ recapitulation property reconciliation", () => {
  it("grandTotal >= workAmount for non-negative charge percentages", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: 10_000_000_000n }),
        fc.double({ min: 0, max: 20, noNaN: true }),
        fc.double({ min: 0, max: 20, noNaN: true }),
        (workAmount, cPct, tPct) => {
          const grand = calculateRecapitulation(workAmount, {
            contingencyPercent: cPct,
            turnoverTaxPercent: tPct,
            workChargePercent: 0,
            qualityControlPercent: 0,
            centagePercent: 0,
            otherCharges: 0n,
          });
          return grand >= workAmount;
        },
      ),
      { numRuns: 100 },
    );
  });

  it("calculateBoqAmount matches manual bigint math for integer quantities", () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 1_000_000_000n }),
        fc.integer({ min: 0, max: 10000 }),
        (rate, qty) => {
          return calculateBoqAmount(rate, qty) === rate * BigInt(qty);
        },
      ),
      { numRuns: 200 },
    );
  });
});
