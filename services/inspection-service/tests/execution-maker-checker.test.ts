/**
 * Maker-checker on inspection sign-off (mirrors capaVerify): an inspector who
 * conducted the inspection cannot finalize it or be its reviewer, and the
 * generic /transition command cannot reach under_review/finalized (those have
 * dedicated commands that enforce the checks).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { isNonRetryable } from "@civitasone/queue";
import { assertMakerCheckerForFinalization, DomainError } from "../src/modules/execution/domain.js";

const H = vi.hoisted(() => ({
  find: vi.fn(), update: vi.fn(), history: vi.fn(),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
  scopedRead: async () => [],
}));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(), markProcessed: vi.fn().mockResolvedValue(true),
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: { makeKey: () => "k" }, invalidateSafely: vi.fn(), queue: {},
}));
vi.mock("../src/modules/execution/repo.js", () => ({
  findInspectionById: vi.fn(),
  findInspectionByIdTx: (...a: unknown[]) => H.find(...a),
  updateInspectionState: (...a: unknown[]) => H.update(...a),
  insertHistory: (...a: unknown[]) => H.history(...a),
}));

import { registerExecutionConsumers } from "../src/modules/execution/consumer.js";
import { COMMANDS } from "../src/topics.js";

const TENANT = "e8ec0000-dead-4000-8000-00000000e8ec";
const INSPECTOR = "e8ec0000-dead-4000-8000-0000000000a1";
const OFFICER = "e8ec0000-dead-4000-8000-0000000000b2";

const handlers = new Map<string, (msg: unknown) => Promise<void>>();
registerExecutionConsumers({
  subscribe: (t: string, h: (msg: unknown) => Promise<void>) => { handlers.set(t, h); },
} as never);

function run(topic: string, actorId: string, payload: Record<string, unknown>) {
  return handlers.get(topic)!({
    messageId: `m-${Math.random()}`, type: topic, tenantId: TENANT, actorId,
    correlationId: "c", schemaVersion: "1.0", payload,
  });
}
async function rejection(p: Promise<void>): Promise<unknown> {
  try { await p; } catch (e) { return e; }
  return undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  H.update.mockResolvedValue({ id: "i1", entityId: "e1", assignedInspectors: [INSPECTOR] });
});

describe("assertMakerCheckerForFinalization", () => {
  it("rejects a conducting inspector", () => {
    expect(() => assertMakerCheckerForFinalization([INSPECTOR], INSPECTOR)).toThrow(DomainError);
  });
  it("admits a different person and tolerates a missing list", () => {
    expect(() => assertMakerCheckerForFinalization([INSPECTOR], OFFICER)).not.toThrow();
    expect(() => assertMakerCheckerForFinalization(undefined, OFFICER)).not.toThrow();
  });
});

describe("inspectionFinalize", () => {
  const insp = { id: "i1", state: "under_review", version: 3, tenantId: TENANT, assignedInspectors: [INSPECTOR] };

  it("refuses (non-retryable) when the finalizer is a conducting inspector", async () => {
    H.find.mockResolvedValue(insp);
    const err = await rejection(run(COMMANDS.inspectionFinalize, INSPECTOR, { inspectionId: "i1" }));
    expect(err).toBeInstanceOf(Error);
    expect(isNonRetryable(err)).toBe(true);
    expect(H.update).not.toHaveBeenCalled();
  });

  it("finalizes when the actor is a different reviewing officer", async () => {
    H.find.mockResolvedValue(insp);
    await run(COMMANDS.inspectionFinalize, OFFICER, { inspectionId: "i1" });
    expect(H.update).toHaveBeenCalledOnce();
  });
});

describe("inspectionSubmitReview", () => {
  const insp = { id: "i1", state: "completed", version: 2, tenantId: TENANT, assignedInspectors: [INSPECTOR] };

  it("refuses a reviewer who is a conducting inspector", async () => {
    H.find.mockResolvedValue(insp);
    const err = await rejection(run(COMMANDS.inspectionSubmitReview, INSPECTOR, { inspectionId: "i1", reviewerId: INSPECTOR }));
    expect(isNonRetryable(err)).toBe(true);
    expect(H.update).not.toHaveBeenCalled();
  });

  it("accepts an independent reviewer", async () => {
    H.find.mockResolvedValue(insp);
    await run(COMMANDS.inspectionSubmitReview, INSPECTOR, { inspectionId: "i1", reviewerId: OFFICER });
    expect(H.update).toHaveBeenCalledOnce();
  });
});

describe("inspectionTransition cannot bypass review/finalize", () => {
  it.each([["under_review", "completed"], ["finalized", "under_review"]])(
    "target %s is rejected as non-retryable without writing",
    async (target, state) => {
      H.find.mockResolvedValue({ id: "i1", state, version: 1, tenantId: TENANT, assignedInspectors: [INSPECTOR] });
      const err = await rejection(run(COMMANDS.inspectionTransition, INSPECTOR, { inspectionId: "i1", targetState: target }));
      expect(isNonRetryable(err)).toBe(true);
      expect(H.update).not.toHaveBeenCalled();
    },
  );
});
