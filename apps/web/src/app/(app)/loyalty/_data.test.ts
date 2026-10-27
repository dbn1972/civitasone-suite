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
  it("ACCRUALS-01/03: enrolment mapper keeps points & balance visible (not buried behind a timestamp)", async () => {
    await getLoyaltyAccruals();
    const c = lastCall();
    expect(c.path).toContain("/api/v1/loyalty/enrolments");
    const result = c.options.mapResponse({
      data: [
        {
          id: "e1",
          programId: "p1",
          profileId: "pf1",
          status: "active",
          tier: "Gold",
          pointsBalance: "4500",
          lifetimePoints: "120",
          enrolledAt: "2026-08-14T09:12:44.000Z",
          updatedAt: "2026-08-14T09:12:44.000Z",
        },
      ],
      meta: { total: 1 },
    }) as { rows: Array<Record<string, unknown>>; total: number | null };
    // GAP-LOYALTY-MEMBERS-04: mapResponse now returns {rows, total}
    expect(result.total).toBe(1);
    const mapped = result.rows;
    expect(mapped[0].pointsBalance).toBe("4500");
    expect(mapped[0].lifetimePoints).toBe("120");
    expect(mapped[0].tier).toBe("Gold");
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

// GAP-LOYALTY-ACCRUALS-02 / MEMBERS-02 (owner decisions D4c #14/#15): the member profile id is
// personal data and must never be held on a row (which the offline cache stores).
describe("loyalty loaders — profile id is personal data (D4c #14/#15)", () => {
  const FULL = "ab12cd34-0000-4000-8000-000000000001";
  // An earlier test swaps fetchJson's implementation; reinstall the capturing one.
  beforeEach(async () => {
    const { fetchJson } = await import("@/app/_data/apiClient");
    vi.mocked(fetchJson).mockImplementation(((path: string, empty: unknown, options: CapturedOptions) => {
      calls.push({ path, empty, options });
      return Promise.resolve({ data: empty, source: "api" });
    }) as never);
  });
  const payload = (extra: Record<string, unknown>) => ({
    data: [{ id: "e1", programId: "p1", status: "active", tier: "Gold", pointsBalance: "1", lifetimePoints: "1", ...extra }],
    meta: { total: 1 },
  });

  it.each([
    ["members", getLoyaltyMembers],
    ["accruals", getLoyaltyAccruals],
  ])("%s: a legacy full profileId is shortened and never kept on the row", async (_n, loader) => {
    await loader();
    const out = lastCall().options.mapResponse(payload({ profileId: FULL })) as { rows: Array<Record<string, unknown>> };
    expect(out.rows[0]!.profileRef).toBe("ab12cd34");
    expect(out.rows[0]).not.toHaveProperty("profileId");
    expect(JSON.stringify(out)).not.toContain(FULL);
  });

  it("passes the service's profileRef straight through", async () => {
    await getLoyaltyMembers();
    const out = lastCall().options.mapResponse(payload({ profileRef: "ab12cd34" })) as { rows: Array<Record<string, unknown>> };
    expect(out.rows[0]!.profileRef).toBe("ab12cd34");
  });
});
