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

import { getExecutionProgress, getExecutionIssues } from "./loaders";

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
