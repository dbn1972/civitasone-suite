import { describe, it, expect } from "vitest";
import { countLast24h } from "./formatters";

describe("countLast24h — GAP-TENANT-ADMIN-AUDIT-01 (rolling 24h window)", () => {
  const now = Date.parse("2026-01-01T01:00:00.000Z"); // 06:30 IST on 2026-01-01

  it("counts an event 23h before now (within the rolling window)", () => {
    expect(countLast24h([{ timestamp: "2025-12-31T23:00:00.000Z" }], now)).toBe(1);
  });

  it("does NOT count an event 26h before now (outside the window) — the old UTC-calendar-day check would also have missed/miscounted it", () => {
    expect(countLast24h([{ timestamp: "2025-12-30T23:00:00.000Z" }], now)).toBe(0);
  });

  it("counts across the UTC day boundary: a 00:30 IST event (previous UTC day) still counts", () => {
    // 00:30 IST on 2026-01-01 == 2025-12-31T19:00:00Z — the old
    // `.slice(0,10) === todayUTC` check (todayUTC = 2026-01-01) would have
    // excluded this; the rolling window includes it.
    expect(countLast24h([{ timestamp: "2025-12-31T19:00:00.000Z" }], now)).toBe(1);
  });

  it("skips unparseable timestamps without throwing", () => {
    expect(countLast24h([{ timestamp: "not-a-date" }, { timestamp: "2025-12-31T23:00:00.000Z" }], now)).toBe(1);
  });
});
