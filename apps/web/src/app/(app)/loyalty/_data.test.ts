import { describe, it, expect, vi, beforeEach } from "vitest";

type MapResponse = (payload: unknown) => unknown;
type CapturedOptions = { mapResponse: MapResponse; telemetryKey: string; responseSchema?: unknown };

// Capture each fetchJson call so we can exercise the mapper and assert the path.
const calls: Array<{ path: string; empty: unknown; options: CapturedOptions }> = [];

vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: vi.fn((path: string, empty: unknown, options: CapturedOptions) => {
    calls.push({ path, empty, options });
    // Default: return empty success so Promise.all in getLoyaltyStats resolves.
    return Promise.resolve({ data: empty, source: "api" });
  }),
}));

import {
  getLoyaltyMembers,
  getLoyaltyAccruals,
  getLoyaltyPrograms,
  getLoyaltyRedemptions,
  getLoyaltyTiers,
  getLoyaltyStats,
} from "./_data";

beforeEach(() => {
  calls.length = 0;
});

function lastCall() {
  return calls[calls.length - 1];
}

describe("loyalty loaders (GAP-LOYALTY-ACCRUALS-01, MEMBERS-01, TIERS-01)", () => {
  it("ACCRUALS-01: accruals loader targets the tenant-wide ledger and maps points transactions", async () => {
    await getLoyaltyAccruals({ limit: 25, offset: 50 });
    const c = lastCall();
    expect(c.path).toContain("/api/v1/loyalty/accruals");
    expect(c.path).not.toContain("/enrolments");
    expect(c.path).toContain("limit=25");
    const result = c.options.mapResponse({
      data: [
        {
          id: "a1",
          enrolmentId: "e1",
          points: "120",
          source: "purchase",
          txType: "bonus",
          accrualDate: "2026-08-14T09:12:44.000Z",
          expiresAt: null,
        },
      ],
      meta: { total: 7 },
    }) as { rows: Array<Record<string, unknown>>; total: number | null };
    expect(result.total).toBe(7);
    expect(result.rows[0].points).toBe("120");
    expect(result.rows[0].txType).toBe("bonus");
    expect(result.rows[0].enrolmentId).toBe("e1");
    expect(result.rows[0].expiresAt).toBeNull();
  });

  it("MEMBERS-01: member mapper surfaces tier as its own field, defaulting to 'base'", async () => {
    await getLoyaltyMembers();
    const c = lastCall();
    const result = c.options.mapResponse({ data: [{ id: "e1", status: "active" }] }) as { rows: Array<Record<string, unknown>>; total: number | null };
    // GAP-LOYALTY-MEMBERS-04: mapResponse now returns {rows, total}; total is null when meta absent
    expect(result.total).toBeNull();
    const mapped = result.rows;
    expect(mapped[0].tier).toBe("base");
    expect(mapped[0].status).toBe("active");
  });

  it("TIERS-01: tiers loader hits /api/v1/loyalty/tiers and flattens definitions", async () => {
    await getLoyaltyTiers();
    const c = lastCall();
    expect(c.path).toContain("/api/v1/loyalty/tiers");
    const mapped = c.options.mapResponse({
      data: [{ id: "t1", programId: "p1", name: "Gold", level: 3, minPointsThreshold: "100000", benefits: {} }],
    }) as Array<Record<string, unknown>>;
    expect(mapped[0].name).toBe("Gold");
    expect(mapped[0].minPointsThreshold).toBe("100000");
  });

  it("MEMBERS-04: pagination params build a limit/offset query string", async () => {
    await getLoyaltyMembers({ limit: 25, offset: 50 });
    const c = lastCall();
    expect(c.path).toContain("limit=25");
    expect(c.path).toContain("offset=50");
  });

  it("programs/redemptions loaders target the right endpoints", async () => {
    await getLoyaltyPrograms();
    expect(lastCall().path).toContain("/api/v1/loyalty/programs");
    await getLoyaltyRedemptions();
    expect(lastCall().path).toContain("/api/v1/loyalty/redemptions");
  });
});

describe("getLoyaltyStats (GAP-LOYALTY-HOME-01)", () => {
  it("returns null figures (not 0) when a list load errors — the error path", async () => {
    const { fetchJson } = await import("@/app/_data/apiClient");
    vi.mocked(fetchJson).mockImplementation(((_path: string, empty: unknown) =>
      Promise.resolve({ data: empty, source: "error" })) as never);
    const stats = await getLoyaltyStats();
    expect(stats.activeMembers).toBeNull();
    expect(stats.pointsIssued).toBeNull();
    expect(stats.redemptionsPending).toBeNull();
  });
});
