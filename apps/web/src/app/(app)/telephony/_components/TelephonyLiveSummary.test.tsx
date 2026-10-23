/**
 * CLOS2-S3-10: the offline "Showing saved data from ..." banner must render the
 * cache time in IST, not in the viewer's zone.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/sync/resource", () => ({
  useOfflineResource: () => ({
    data: { total: 1, live: 0, answered: 1, abandoned: 0, slaScored: 1, slaMet: 1 },
    source: "cache",
    offline: true,
    cachedAt: Date.parse("2026-10-22T10:00:00Z"),
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));
vi.mock("@/lib/telephony/callMetrics", async (orig) => ({
  ...(await orig<typeof import("@/lib/telephony/callMetrics")>()),
  metricsToSummary: () => ({ total: 1, live: 0, answered: 1, abandoned: 0, slaScored: 1, slaMet: 1, slaPct: 100 }),
}));

import { TelephonyLiveSummary } from "./TelephonyLiveSummary";

describe("TelephonyLiveSummary cached banner (CLOS2-S3-10)", () => {
  const prevTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "UTC";
  });
  afterAll(() => {
    if (prevTz === undefined) delete process.env.TZ;
    else process.env.TZ = prevTz;
  });

  it("shows the cache time in IST (15:30), not the viewer's UTC zone", () => {
    render(<TelephonyLiveSummary />);
    const note = screen.getByRole("status").textContent ?? "";
    expect(note).toMatch(/03:30 pm IST/i);
    expect(note).not.toMatch(/10:00/);
  });
});
