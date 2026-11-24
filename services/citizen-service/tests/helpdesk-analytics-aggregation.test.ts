import { describe, it, expect, vi } from "vitest";

vi.mock("../src/modules/helpdesk/repo.js", () => ({
  countTicketsByStatus: vi.fn(async () => [
    { status: "open", count: 3 },
    { status: "resolved", count: 1 },
  ]),
  countBreachedTickets: vi.fn(async () => 1),
  countTicketsByDimension: vi.fn(async (_t: string, dim: string) =>
    dim === "priority"
      ? [{ key: "low", count: 1 }, { key: "high", count: 3 }]
      : [{ key: "web", count: 4 }]),
  avgResolutionHours: vi.fn(async () => 12.34),
}));

describe("getTicketAnalytics aggregations", () => {
  it("returns non-empty byPriority/byChannel and a real avgResolutionHours", async () => {
    const { getTicketAnalytics } = await import("../src/modules/helpdesk/queries.js");
    const r = await getTicketAnalytics("00000000-0000-0000-0000-000000000001");
    expect(r.byPriority).toEqual([
      { priority: "high", count: 3, pct: 75 },
      { priority: "low", count: 1, pct: 25 },
    ]);
    expect(r.byChannel).toEqual([{ channel: "web", count: 4, pct: 100 }]);
    expect(r.avgResolutionHours).toBe(12.3);
  });
});
