/**
 * Gap batch b1-payroll-tax — consumer-side and pure-function regressions.
 *
 *   GAP-PAYROLL-CORRECTIONS-01   correctionDecide consumer: conditional UPDATE
 *                                re-asserts pending + decider != creator;
 *                                emits correctionDecided + audit only when a
 *                                row actually changed.
 *   GAP-PAYROLL-STATUTORY-LWF-02 stateRulesUpsert: omitted LWF fields are
 *                                preserved (COALESCE), frequency is written.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const TENANT = "bbbbbbbb-0b11-4000-8000-000000000b11";
const ACTOR = "00000000-0b11-4000-8000-00000000000b";

vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: vi.fn(), subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() },
  cache: {
    getOrLoad: vi.fn((_k: string, fn: () => unknown) => fn()),
    invalidate: vi.fn(),
    invalidateResource: vi.fn(),
    makeKey: (...parts: string[]) => parts.join(":"),
    put: vi.fn(),
  },
}));

const executed: Array<{ text: string; params: unknown[] }> = [];
let nextRows: unknown[] = [];
type Chunk = { value?: unknown } | unknown;
function render(query: { queryChunks: Chunk[] }): { text: string; params: unknown[] } {
  let text = "";
  const params: unknown[] = [];
  for (const c of query.queryChunks) {
    if (c && typeof c === "object" && Array.isArray((c as { value?: unknown }).value)) {
      text += ((c as { value: string[] }).value).join("");
    } else {
      params.push(c);
      text += "$";
    }
  }
  return { text: text.replace(/\s+/g, " "), params };
}
const mockTx = {
  execute: (query: { queryChunks: Chunk[] }) => {
    executed.push(render(query));
    return Promise.resolve(nextRows);
  },
};
vi.mock("../src/shared/db.js", async () => {
  const actual = await vi.importActual<typeof import("../src/shared/db.js")>("../src/shared/db.js");
  return { ...actual, db: { transaction: (fn: (tx: unknown) => unknown) => fn(mockTx), execute: vi.fn() } };
});

const enqueued: Array<{ topic: string; payload: Record<string, unknown> }> = [];
vi.mock("../src/shared/outbox.js", async () => {
  const actual = await vi.importActual<typeof import("../src/shared/outbox.js")>("../src/shared/outbox.js");
  return {
    ...actual,
    markProcessed: vi.fn(() => Promise.resolve(true)),
    enqueue: vi.fn((_tx: unknown, ev: { topic: string; payload: Record<string, unknown> }) => {
      enqueued.push(ev);
      return Promise.resolve();
    }),
  };
});

const { registerPayrollConsumers } = await import("../src/modules/payroll/consumer.js");
const { COMMANDS, EVENTS } = await import("../src/topics.js");

const handlers: Record<string, (msg: unknown) => Promise<void>> = {};
registerPayrollConsumers({ subscribe: (t: string, fn: (msg: unknown) => Promise<void>) => { handlers[t] = fn; } } as never);

const baseMsg = { tenantId: TENANT, actorId: ACTOR, correlationId: "corr-b1", schemaVersion: "1.0" };

beforeEach(() => {
  executed.length = 0;
  enqueued.length = 0;
  nextRows = [];
});

describe("GAP-PAYROLL-CORRECTIONS-01: correctionDecide consumer", () => {
  it("registers a handler", () => {
    expect(typeof handlers[COMMANDS.correctionDecide]).toBe("function");
  });

  it("guards the UPDATE on status='pending' and created_by <> decider, then emits event + audit", async () => {
    nextRows = [{ id: "c-1", employee_id: "emp-1" }];
    await handlers[COMMANDS.correctionDecide]!({
      ...baseMsg, messageId: "m-dec-1",
      payload: { id: "c-1", tenantId: TENANT, decision: "approved", note: "ok" },
    });
    expect(executed).toHaveLength(1);
    expect(executed[0]!.text).toMatch(/status = 'pending' AND created_by <> \$::uuid/);
    expect(executed[0]!.params).toContain(ACTOR);
    expect(executed[0]!.params).toContain("approved");
    const ev = enqueued.find((e) => e.topic === EVENTS.correctionDecided);
    expect(ev?.payload).toMatchObject({ id: "c-1", employeeId: "emp-1", decision: "approved" });
    expect(enqueued.some((e) => (e.payload as { action?: string }).action === "approve")).toBe(true);
  });

  it("is a silent no-op when no row matched (raced, already decided, or self-decision)", async () => {
    nextRows = [];
    await handlers[COMMANDS.correctionDecide]!({
      ...baseMsg, messageId: "m-dec-2",
      payload: { id: "c-1", tenantId: TENANT, decision: "rejected", note: "x" },
    });
    expect(enqueued).toHaveLength(0);
  });
});

describe("GAP-PAYROLL-STATUTORY-LWF-02: stateRulesUpsert preserves omitted LWF fields", () => {
  it("COALESCEs every LWF column against the stored row on conflict and writes frequency", async () => {
    await handlers[COMMANDS.stateRulesUpsert]!({
      ...baseMsg, messageId: "m-lwf-1",
      payload: { tenantId: TENANT, stateCode: "MH", lwfEmployee: 2500 },
    });
    const lwf = executed.find((q) => q.text.includes("payroll.payroll_lwf"));
    expect(lwf).toBeDefined();
    expect(lwf!.text).toContain("employer_contrib_minor = COALESCE($::bigint, payroll.payroll_lwf.employer_contrib_minor)");
    expect(lwf!.text).toContain("frequency = COALESCE($::varchar, payroll.payroll_lwf.frequency)");
    // employee given, employer + frequency omitted => passed as null, not 0.
    expect(lwf!.params).toContain("2500");
    expect(lwf!.params.filter((p) => p === null).length).toBeGreaterThanOrEqual(2);
    expect(lwf!.params).not.toContain("0");
  });

  it("runs the LWF upsert when only the frequency is posted", async () => {
    await handlers[COMMANDS.stateRulesUpsert]!({
      ...baseMsg, messageId: "m-lwf-2",
      payload: { tenantId: TENANT, stateCode: "MH", lwfFrequency: "yearly" },
    });
    const lwf = executed.find((q) => q.text.includes("payroll.payroll_lwf"));
    expect(lwf?.params).toContain("yearly");
  });
});
