/**
 * b3 payroll-adjustments gap batch -- publisher/consumer half (mocked queue,
 * tx and outbox, same harness as tests/T1-03-gap-routes-cqrs.test.ts):
 *
 *  - GAP-PAYROLL-OFF-CYCLE-04: the processing reason travels in the command
 *    and lands in the audit record.
 *  - GAP-PAYROLL-REIMBURSEMENTS-02: the decide consumer transitions only a
 *    `submitted` claim, sets approved_by only on approval, and audits the
 *    decision + reason; a no-op UPDATE writes no audit.
 *  - GAP-PAYROLL-FLEX-BENEFITS-01/03: electionViolation (pure).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const TENANT = "aaaaaaaa-0b03-4000-8000-000000000b03";
const ACTOR = "00000000-0b03-4000-8000-000000000001";

const mockPublish = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: mockPublish, subscribe: vi.fn(), start: vi.fn(), stop: vi.fn() },
  cache: {
    getOrLoad: vi.fn((_k: string, fn: () => unknown) => fn()),
    invalidate: vi.fn(),
    invalidateResource: vi.fn(),
    makeKey: (...parts: string[]) => parts.join(":"),
    put: vi.fn(),
  },
}));

const executedQueries: unknown[] = [];
let nextRows: unknown[] = [];
const rowQueue: unknown[][] = [];
const mockTx = {
  execute: (query: unknown) => {
    executedQueries.push(query);
    // A queued response (consumed in order) wins over the static nextRows.
    return Promise.resolve(rowQueue.length > 0 ? rowQueue.shift() : nextRows);
  },
};
vi.mock("../src/shared/db.js", async () => {
  const actual = await vi.importActual<typeof import("../src/shared/db.js")>("../src/shared/db.js");
  return { ...actual, db: { transaction: (fn: (tx: unknown) => unknown) => fn(mockTx), execute: vi.fn() } };
});

const mockEnqueued: Array<{ topic: string; payload: Record<string, unknown> }> = [];
vi.mock("../src/shared/outbox.js", async () => {
  const actual = await vi.importActual<typeof import("../src/shared/outbox.js")>("../src/shared/outbox.js");
  return {
    ...actual,
    markProcessed: vi.fn(() => Promise.resolve(true)),
    enqueue: vi.fn((_tx: unknown, ev: { topic: string; payload: Record<string, unknown> }) => {
      mockEnqueued.push(ev);
      return Promise.resolve();
    }),
  };
});

const baseMsg = { tenantId: TENANT, actorId: ACTOR, correlationId: "corr-b3", schemaVersion: "1.0" };
const baseCtx = { tenantId: TENANT, actorId: ACTOR, correlationId: "corr-b3", roles: ["payroll_admin"], sessionId: "s", actorType: "user" } as never;

function sqlText(query: unknown): string {
  const chunks = (query as { queryChunks: unknown[] }).queryChunks;
  return chunks
    .map((c) => (c && typeof c === "object" && Array.isArray((c as { value?: unknown }).value) ? (c as { value: string[] }).value.join("") : "?"))
    .join("");
}
function paramsOf(query: unknown): unknown[] {
  return (query as { queryChunks: unknown[] }).queryChunks.filter(
    (c) => !(c && typeof c === "object" && Array.isArray((c as { value?: unknown }).value)),
  );
}

async function handlers() {
  const { registerPayrollConsumers } = await import("../src/modules/payroll/consumer.js");
  const map: Record<string, (msg: unknown) => Promise<void>> = {};
  registerPayrollConsumers({ subscribe: (t: string, fn: (msg: unknown) => Promise<void>) => { map[t] = fn; } } as never);
  return map;
}

beforeEach(() => {
  mockPublish.mockClear();
  executedQueries.length = 0;
  mockEnqueued.length = 0;
  nextRows = [];
  rowQueue.length = 0;
});

describe("GAP-PAYROLL-OFF-CYCLE-04: process reason is audited", () => {
  it("processOffCycle carries the reason in the command payload", async () => {
    const { processOffCycle } = await import("../src/modules/payroll/commands.js");
    await processOffCycle(baseCtx, "oc-1", "Diwali incentive, approved by DDO");
    expect(mockPublish.mock.calls[0][1].payload.reason).toBe("Diwali incentive, approved by DDO");
  });

  it("the consumer's audit record includes the reason", async () => {
    const { COMMANDS } = await import("../src/topics.js");
    // #1761's consumer first re-reads the run under a row lock (draft, and
    // not processed by its creator), then the items.
    rowQueue.push([{ status: "draft", created_by: "00000000-0b03-4000-8000-0000000000ff" }]);
    nextRows = [{ id: "item-1", employee_id: "e1", amount_minor: "1000" }];
    await (await handlers())[COMMANDS.offCycleProcess]({
      ...baseMsg, messageId: "m-b3-ocp", payload: { id: "oc-1", tenantId: TENANT, reason: "Diwali incentive, approved by DDO" },
    });
    const auditEv = mockEnqueued.find((e) => e.topic === "audit.event.record");
    expect(auditEv?.payload).toMatchObject({ action: "process", resourceId: "oc-1", reason: "Diwali incentive, approved by DDO" });
  });
});

describe("GAP-PAYROLL-REIMBURSEMENTS-02: decide consumer", () => {
  it("decideReimbursement publishes one deterministic decide command", async () => {
    const { decideReimbursement } = await import("../src/modules/payroll/commands.js");
    const { COMMANDS } = await import("../src/topics.js");
    await decideReimbursement(baseCtx, "r-1", "rejected", "Bill does not match");
    await decideReimbursement(baseCtx, "r-1", "rejected", "Bill does not match");
    const [topic, msg] = mockPublish.mock.calls[0];
    expect(topic).toBe(COMMANDS.reimbursementDecide);
    expect(msg.payload).toMatchObject({ id: "r-1", decision: "rejected", reason: "Bill does not match" });
    expect(mockPublish.mock.calls[1][1].messageId).toBe(msg.messageId);
  });

  it("approve: conditional UPDATE on status='submitted', approved_by = actor, audited", async () => {
    const { COMMANDS } = await import("../src/topics.js");
    nextRows = [{ id: "r-1" }];
    await (await handlers())[COMMANDS.reimbursementDecide]({
      ...baseMsg, messageId: "m-b3-dec-1", payload: { id: "r-1", tenantId: TENANT, decision: "approved", reason: null },
    });
    expect(executedQueries).toHaveLength(1);
    expect(sqlText(executedQueries[0])).toMatch(/status = 'submitted'/);
    expect(paramsOf(executedQueries[0])).toContain(ACTOR);
    const auditEv = mockEnqueued.find((e) => e.topic === "audit.event.record");
    expect(auditEv?.payload).toMatchObject({ action: "approve", resourceType: "payroll_reimbursement", newValue: { status: "approved" } });
  });

  it("reject: approved_by stays null; reason in the audit record", async () => {
    const { COMMANDS } = await import("../src/topics.js");
    nextRows = [{ id: "r-2" }];
    await (await handlers())[COMMANDS.reimbursementDecide]({
      ...baseMsg, messageId: "m-b3-dec-2", payload: { id: "r-2", tenantId: TENANT, decision: "rejected", reason: "Bill does not match" },
    });
    expect(paramsOf(executedQueries[0])).not.toContain(ACTOR);
    const auditEv = mockEnqueued.find((e) => e.topic === "audit.event.record");
    expect(auditEv?.payload).toMatchObject({ action: "reject", reason: "Bill does not match" });
  });

  it("no audit when the claim was no longer submitted (UPDATE matched nothing)", async () => {
    const { COMMANDS } = await import("../src/topics.js");
    nextRows = [];
    await (await handlers())[COMMANDS.reimbursementDecide]({
      ...baseMsg, messageId: "m-b3-dec-3", payload: { id: "r-3", tenantId: TENANT, decision: "approved" },
    });
    expect(mockEnqueued).toHaveLength(0);
  });
});

describe("GAP-PAYROLL-FLEX-BENEFITS-01/03: electionViolation", () => {
  const plan = { fy: "2026-27", totalBudgetMinor: 1000n, components: [{ name: "A", maxMinor: 800 }, { name: "B", maxMinor: 800 }] };

  it("accepts an election inside caps and budget", async () => {
    const { electionViolation } = await import("../src/modules/payroll/adjustment-guards.js");
    expect(electionViolation(plan, { fy: "2026-27", elections: [{ component: "A", electedMinor: 800 }, { component: "B", electedMinor: 200 }] })).toBeNull();
  });

  it.each([
    ["unknown component", { fy: "2026-27", elections: [{ component: "C", electedMinor: 1 }] }],
    ["above component max", { fy: "2026-27", elections: [{ component: "A", electedMinor: 801 }] }],
    ["above plan budget", { fy: "2026-27", elections: [{ component: "A", electedMinor: 800 }, { component: "B", electedMinor: 201 }] }],
    ["duplicate component", { fy: "2026-27", elections: [{ component: "A", electedMinor: 1 }, { component: "A", electedMinor: 1 }] }],
    ["FY mismatch", { fy: "2025-26", elections: [{ component: "A", electedMinor: 1 }] }],
  ])("rejects %s", async (_label, election) => {
    const { electionViolation } = await import("../src/modules/payroll/adjustment-guards.js");
    expect(electionViolation(plan, election)).not.toBeNull();
  });
});
