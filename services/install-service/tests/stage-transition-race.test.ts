import { describe, it, expect, vi, beforeEach } from "vitest";
import type { CommandEnvelope } from "@civitasone/queue";

const findRowTx = vi.fn();
const updateLifecycle = vi.fn();
const enqueue = vi.fn();
const markProcessed = vi.fn();

vi.mock("../src/modules/stages/repo.js", () => ({ findRowTx, updateLifecycle, insert: vi.fn() }));
vi.mock("../src/shared/outbox.js", () => ({ enqueue, markProcessed }));
vi.mock("../src/shared/db.js", () => ({ db: {} }));
vi.mock("../src/shared/infra.js", () => ({ cache: { makeKey: vi.fn(), put: vi.fn(), invalidate: vi.fn(), invalidateResource: vi.fn() } }));

const { applyStageTransition } = await import("../src/modules/stages/consumer.js");

const TENANT = globalThis.crypto.randomUUID();
const ACTOR = globalThis.crypto.randomUUID();
const STAGE = globalThis.crypto.randomUUID();

function cmd(verb: "run" | "skip" | "retry") {
  return {
    messageId: globalThis.crypto.randomUUID(),
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: globalThis.crypto.randomUUID(),
    payload: { id: STAGE, verb },
  } as unknown as CommandEnvelope<{ id: string; verb: "run" | "skip" | "retry" }>;
}

describe("stage transition re-validates against the locked row", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markProcessed.mockResolvedValue(true);
  });

  it("skip arriving after a run already moved the row to in_progress is a no-op", async () => {
    findRowTx.mockResolvedValue({ id: STAGE, status: "in_progress", version: 2, startedAt: new Date() });
    await applyStageTransition({}, cmd("skip"));
    expect(updateLifecycle).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("skip on a pending row applies, guarded by the version it read", async () => {
    findRowTx.mockResolvedValue({ id: STAGE, status: "pending", version: 1, startedAt: null });
    await applyStageTransition({}, cmd("skip"));
    expect(updateLifecycle).toHaveBeenCalledTimes(1);
    expect(updateLifecycle.mock.calls[0]![4]).toBe(1);
    expect(updateLifecycle.mock.calls[0]![5]).toMatchObject({ status: "skipped" });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});
