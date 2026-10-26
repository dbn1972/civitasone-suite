/**
 * CLOS3-S4-12: emitLeadScoredEvent is best-effort, but an async queue.publish rejection must be
 * caught and logged (not surface as an unhandledRejection). No DB: fetch and queue are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logMock = vi.hoisted(() => ({
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(),
}));
vi.mock("pino", () => ({ pino: () => logMock }));

import { queue } from "../src/shared/infra.js";
import { scoreLeadWithMl, type LeadFeatures } from "../src/modules/leads/ml-scoring.js";

const features: LeadFeatures = {
  daysInStage: 5,
  interactionCount: 3,
  companySizeBucket: "medium",
  dealValueBucket: "high",
  sourceChannel: "website",
  lastActivityRecencyDays: 7,
};

const highConfidenceFetch = () =>
  vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      prediction: 0.9, confidence: 0.99, factors: [], fallback: false, modelVersion: 2, advisory: true,
    }),
  });

const unhandled: unknown[] = [];
const onUnhandled = (e: unknown) => { unhandled.push(e); };
const macrotask = () => new Promise((r) => setTimeout(r, 25));

describe("CLOS3-S4-12 lead_scored emit", () => {
  beforeEach(() => {
    unhandled.length = 0;
    logMock.error.mockClear();
    process.on("unhandledRejection", onUnhandled);
    vi.stubGlobal("fetch", highConfidenceFetch());
  });
  afterEach(() => {
    process.off("unhandledRejection", onUnhandled);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("async publish rejection is logged, not unhandled", async () => {
    vi.spyOn(queue, "publish").mockRejectedValue(new Error("redis"));
    const r = await scoreLeadWithMl("t1", "lead-1", features, "tok", "corr-1");
    await macrotask();
    expect(r.isFallback).toBe(false);
    expect(unhandled).toEqual([]);
    expect(logMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "t1", entityId: "lead-1", err: "redis" }),
      "failed to emit lead_scored event",
    );
  });

  it("synchronous publish throw is still logged", async () => {
    vi.spyOn(queue, "publish").mockImplementation(() => { throw new Error("sync boom"); });
    await scoreLeadWithMl("t1", "lead-1", features, "tok", "corr-1");
    await macrotask();
    expect(unhandled).toEqual([]);
    expect(logMock.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: "sync boom" }),
      "failed to emit lead_scored event",
    );
  });

  it("successful publish logs no error", async () => {
    const pub = vi.spyOn(queue, "publish").mockResolvedValue(undefined as never);
    await scoreLeadWithMl("t1", "lead-1", features, "tok", "corr-1");
    await macrotask();
    expect(pub).toHaveBeenCalledTimes(1);
    expect(unhandled).toEqual([]);
    expect(logMock.error).not.toHaveBeenCalled();
  });
});
