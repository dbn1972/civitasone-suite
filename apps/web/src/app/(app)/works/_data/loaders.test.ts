import { describe, it, expect, vi } from "vitest";

// Capture each loader's mapResponse by stubbing fetchJson, then run it against
// a realistic works-service payload to assert the display mapping.
const captured: Record<string, (p: unknown) => unknown> = {};
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (_url: string, fallback: unknown, opts: { telemetryKey: string; mapResponse: (p: unknown) => unknown }) => {
    captured[opts.telemetryKey] = opts.mapResponse;
    return Promise.resolve({ data: fallback, source: "api" });
  },
}));

import { getExecutionProgress, getExecutionIssues, getBoqItems, getBoqIndexSummary } from "./loaders";

describe("execution loaders mapping (GAP-WORKS-EXECUTION-01)", () => {
  it("progress rows show the work number + scope description, not UUID prefixes", async () => {
    await getExecutionProgress();
    const map = captured["works.execution.progress"];
    const rows = map({
      data: [
        {
          id: "p1",
          workId: "3f9a1c20-aaaa-bbbb-cccc-dddddddddddd",
          scopeId: "aaaaaaaa-1111-2222-3333-444444444444",
          workNumber: "W-2025-014",
          description: "Earthwork in excavation",
          targetValue: "100",
          currentAchievement: "30",
          percentage: 30,
        },
      ],
    }) as Array<Record<string, unknown>>;
    expect(rows[0].work).toBe("W-2025-014");
    expect(rows[0].scope).toBe("Earthwork in excavation");
    expect(String(rows[0].work)).not.toContain("…");
  });

  it("falls back to a UUID prefix only when the work number is absent", async () => {
    await getExecutionProgress();
    const map = captured["works.execution.progress"];
    const rows = map({ data: [{ id: "p2", workId: "3f9a1c20-aaaa-bbbb-cccc-dddddddddddd" }] }) as Array<
      Record<string, unknown>
    >;
    expect(rows[0].work).toBe("3f9a1c20…");
  });

  it("issue rows show the work number", async () => {
    await getExecutionIssues();
    const map = captured["works.execution.issues"];
    const rows = map({
      data: [{ id: "i1", workId: "w", workNumber: "W-2025-099", description: "Crack", status: "open" }],
    }) as Array<Record<string, unknown>>;
    expect(rows[0].work).toBe("W-2025-099");
  });
});

describe("BoQ index loaders (GAP-WORKS-BOQ-02 / BOQ-04)", () => {
  it("BOQ-02: totals come from the list meta (full set), with the fetched page size reported for the 'showing first N' hint", async () => {
    await getBoqIndexSummary();
    const map = captured["works.boq.summary"];
    const rows = Array.from({ length: 100 }, (_v, i) => ({ id: `b${i}`, amountMinor: "1000" }));
    const out = map({ data: rows, meta: { total: 150, totalAmountMinor: "9007199254740993" } }) as { total: number; totalAmountMinor: string; fetched: number };
    expect(out.total).toBe(150);
    expect(out.fetched).toBe(100);
    // exact bigint string, never a float-rounded sum
    expect(out.totalAmountMinor).toBe("9007199254740993");
  });

  it("BOQ-02: without meta it falls back to the BigInt sum of the fetched page", async () => {
    await getBoqIndexSummary();
    const map = captured["works.boq.summary"];
    const out = map({ data: [{ amountMinor: "9007199254740993" }, { amountMinor: "1" }] }) as { total: number; totalAmountMinor: string };
    expect(out.total).toBe(2);
    expect(out.totalAmountMinor).toBe("9007199254740994");
  });

  it("BOQ-04: a row keeps its srItemId so the page can count SR-linked lines", async () => {
    await getBoqItems();
    const map = captured["works.boq"];
    const rows = map({ data: [{ id: "a", srItemId: "sr-1", itemCode: "X" }, { id: "b", itemCode: "Y" }] }) as Array<{ srItemId: string | null }>;
    expect(rows[0]!.srItemId).toBe("sr-1");
    expect(rows[1]!.srItemId).toBeNull();
  });
});
