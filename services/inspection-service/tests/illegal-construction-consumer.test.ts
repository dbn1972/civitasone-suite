/**
 * illegal-construction consumer — regression coverage for a critical bug
 * caught by review after this module's consumer.ts first shipped: the
 * illegalConstructionActionIssue handler's "skip the strict transition
 * check while the case is in a state no command can produce" guard listed
 * the wrong states (notice_issued/hearing_done — states nothing can ever
 * reach) instead of the one real predecessor state (violation_confirmed).
 * That made 3 of the module's 4 status-changing action types
 * (stop_work_notice, sealing_order, demolition_order) throw
 * INVALID_TRANSITION on every real call; only regularization_order
 * happened to work. Confirmed live against the real shared dev DB before
 * fixing (see PR description), then fixed and confirmed live again — this
 * is the automated regression guard for that fix, since neither
 * all-modules-mounted.test.ts (asserts only "not a 404") nor any other
 * existing test exercised this consumer's actual logic at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const TENANT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const USER_ID = "11111111-2222-3333-4444-555555555555";
const CASE_ID = "cccccccc-1111-2222-3333-444444444444";

const handlers = new Map<string, (msg: unknown) => Promise<void>>();

const mockTx = { id: "tx" };

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: vi.fn(async (fn: (tx: unknown) => Promise<void>) => fn(mockTx)) },
}));

vi.mock("../src/shared/outbox.js", () => ({
  markProcessed: vi.fn(async () => true),
  enqueue: vi.fn(async () => undefined),
}));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: vi.fn().mockResolvedValue(undefined),
    makeKey: vi.fn((...args: string[]) => args.join(":")),
  },
  invalidateSafely: vi.fn().mockResolvedValue(undefined),
  queue: {
    publish: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn((topic: string, handler: (msg: unknown) => Promise<void>) => {
      handlers.set(topic, handler);
    }),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
  },
}));

// A real case sitting in the one state issueAction is ever actually called
// from — matches what a case created via illegalConstructionCaseCreate and
// then confirmed via illegalConstructionConfirm looks like in production.
const violationConfirmedCase = {
  id: CASE_ID, tenantId: TENANT_ID, status: "violation_confirmed",
  violationType: "no_permit", version: 1,
};

let updateCaseCalls: Array<{ id: string; data: Record<string, unknown> }> = [];

vi.mock("../src/modules/illegal-construction/repo.js", () => ({
  findCaseById: vi.fn(async () => violationConfirmedCase),
  updateCase: vi.fn(async (_tx: unknown, id: string, _tenantId: string, data: Record<string, unknown>) => {
    updateCaseCalls.push({ id, data });
    return { ...violationConfirmedCase, ...data };
  }),
  insertAction: vi.fn(async (_tx: unknown, data: Record<string, unknown>) => ({ id: "action-1", ...data })),
  updateAction: vi.fn(async (_tx: unknown, id: string, _tenantId: string, data: Record<string, unknown>) => ({ id, ...data })),
  findActionById: vi.fn(),
}));

async function loadConsumer() {
  const { registerIllegalConstructionConsumers } = await import("../src/modules/illegal-construction/consumer.js");
  const { COMMANDS } = await import("../src/topics.js");
  registerIllegalConstructionConsumers({ subscribe: handlers.set.bind(handlers) } as never);
  return COMMANDS;
}

describe("illegalConstructionActionIssue — status-changing actions from violation_confirmed", () => {
  beforeEach(() => {
    handlers.clear();
    updateCaseCalls = [];
    vi.clearAllMocks();
  });

  it.each([
    ["stop_work_notice", "stop_work_ordered"],
    ["sealing_order", "sealed"],
    ["demolition_order", "demolition_ordered"],
  ])("actionType=%s drives the case from violation_confirmed to %s (not INVALID_TRANSITION)", async (actionType, expectedStatus) => {
    const COMMANDS = await loadConsumer();
    const handler = handlers.get(COMMANDS.illegalConstructionActionIssue)!;

    await expect(
      handler({
        messageId: `msg-${actionType}`, actorId: USER_ID, tenantId: TENANT_ID, correlationId: "corr-1",
        payload: { caseId: CASE_ID, tenantId: TENANT_ID, actionType, details: {} },
      }),
    ).resolves.not.toThrow();

    expect(updateCaseCalls).toHaveLength(1);
    expect(updateCaseCalls[0]?.data.status).toBe(expectedStatus);
  });

  it("actionType=fine never calls updateCase (no case-level status change)", async () => {
    const COMMANDS = await loadConsumer();
    const handler = handlers.get(COMMANDS.illegalConstructionActionIssue)!;

    await handler({
      messageId: "msg-fine", actorId: USER_ID, tenantId: TENANT_ID, correlationId: "corr-1",
      payload: { caseId: CASE_ID, tenantId: TENANT_ID, actionType: "fine", fineAmountMinor: "50000" },
    });

    expect(updateCaseCalls).toHaveLength(0);
  });

  it("a malformed fineAmountMinor is rejected as non-retryable, not thrown as a raw SyntaxError", async () => {
    const COMMANDS = await loadConsumer();
    const handler = handlers.get(COMMANDS.illegalConstructionActionIssue)!;
    const { NonRetryableError } = await import("@civitasone/queue");

    await expect(
      handler({
        messageId: "msg-bad-fine", actorId: USER_ID, tenantId: TENANT_ID, correlationId: "corr-1",
        payload: { caseId: CASE_ID, tenantId: TENANT_ID, actionType: "fine", fineAmountMinor: "25000.50" },
      }),
    ).rejects.toBeInstanceOf(NonRetryableError);
  });

  it("regularization_order on an ineligible violation type is rejected even though the transition table alone would allow it", async () => {
    const { findCaseById } = await import("../src/modules/illegal-construction/repo.js");
    vi.mocked(findCaseById).mockResolvedValueOnce({
      ...violationConfirmedCase, violationType: "fsi_exceeded", // canRegularize excludes this
    });
    const COMMANDS = await loadConsumer();
    const handler = handlers.get(COMMANDS.illegalConstructionActionIssue)!;

    await expect(
      handler({
        messageId: "msg-regularize", actorId: USER_ID, tenantId: TENANT_ID, correlationId: "corr-1",
        payload: { caseId: CASE_ID, tenantId: TENANT_ID, actionType: "regularization_order", details: {} },
      }),
    ).rejects.toThrow(/not eligible for regularization/);
    expect(updateCaseCalls).toHaveLength(0);
  });
});
