import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// _data.ts calls fetchJson(path, empty, {mapResponse}). We capture the
// mapResponse and the `empty` fallback by mocking apiClient, so these tests
// exercise the real mapping logic without any network.
const captured = vi.hoisted(() => ({
  overviewMap: null as ((p: unknown) => unknown) | null,
  overviewEmpty: null as unknown,
  evalMap: null as ((p: unknown) => unknown) | null,
  evalEmpty: null as unknown,
}));

vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: async (path: string, empty: unknown, opts: { mapResponse: (p: unknown) => unknown }) => {
    if (path.includes("domain=")) {
      captured.evalMap = opts.mapResponse;
      captured.evalEmpty = empty;
    } else {
      captured.overviewMap = opts.mapResponse;
      captured.overviewEmpty = empty;
    }
    return { data: empty, source: "api" };
  },
}));

const { getMLDomainOverview, getMLDomainEvaluation } = await import("./_data");

beforeEach(async () => {
  await getMLDomainOverview();
  await getMLDomainEvaluation("leads");
});
afterEach(() => vi.clearAllMocks());

describe("GAP-ANALYTICS-ML-INSIGHTS-*-05/06: nullable rate mapping", () => {
  it("maps a missing accuracy/fallbackRate to null, not 0 (empty fallback)", () => {
    const ev = captured.evalEmpty as { accuracy: number | null; fallbackRate: number | null };
    expect(ev.accuracy).toBeNull();
    expect(ev.fallbackRate).toBeNull();
  });

  it("keeps a genuine 0 as 0 (distinct from missing)", () => {
    const mapped = captured.evalMap!({ data: { totalPredictions: 5, accuracy: 0, fallbackRate: 0 } }) as {
      accuracy: number | null;
      fallbackRate: number | null;
    };
    expect(mapped.accuracy).toBe(0);
    expect(mapped.fallbackRate).toBe(0);
  });

  it("sources accuracy from avgConfidence when no explicit accuracy field", () => {
    const mapped = captured.evalMap!({ data: { totalPredictions: 5, avgConfidence: 0.82 } }) as { accuracy: number | null };
    expect(mapped.accuracy).toBeCloseTo(0.82);
  });
});

describe("GAP-ANALYTICS-ML-INSIGHTS-*-UUID: entityLabel/parentId mapping", () => {
  it("maps optional entityLabel and parentId when present", () => {
    const mapped = captured.evalMap!({
      data: {
        totalPredictions: 1,
        recentPredictions: [{ id: "p1", entityId: "e1", entityLabel: "Acme Co", parentId: "proj-9", prediction: 0.5, confidence: 0.9 }],
      },
    }) as { recentPredictions: Array<{ entityLabel: string | null; parentId: string | null }> };
    expect(mapped.recentPredictions[0]!.entityLabel).toBe("Acme Co");
    expect(mapped.recentPredictions[0]!.parentId).toBe("proj-9");
  });

  it("defaults entityLabel/parentId to null when absent", () => {
    const mapped = captured.evalMap!({
      data: { totalPredictions: 1, recentPredictions: [{ id: "p1", entityId: "e1", prediction: 0.5, confidence: 0.9 }] },
    }) as { recentPredictions: Array<{ entityLabel: string | null; parentId: string | null }> };
    expect(mapped.recentPredictions[0]!.entityLabel).toBeNull();
    expect(mapped.recentPredictions[0]!.parentId).toBeNull();
  });
});

describe("hub overview mapping", () => {
  it("maps per-domain avgConfidence into nullable accuracy", () => {
    const mapped = captured.overviewMap!({ domains: [{ domain: "leads", totalPredictions: 10, avgConfidence: 0.9 }] }) as Array<{
      accuracy: number | null;
      fallbackRate: number | null;
    }>;
    expect(mapped[0]!.accuracy).toBeCloseTo(0.9);
    expect(mapped[0]!.fallbackRate).toBeNull();
  });
});
