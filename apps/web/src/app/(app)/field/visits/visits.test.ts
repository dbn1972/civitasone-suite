import { describe, it, expect } from "vitest";
import {
  formatCoord,
  outcomeLabel,
  rankVisits,
  visitStatus,
  visitDisplayStatus,
  openVisitHours,
  type FieldVisit,
} from "./visits";

function visit(overrides: Partial<FieldVisit> = {}): FieldVisit {
  return {
    id: "1",
    taskId: "t1",
    agentId: "a1",
    checkInLatitude: "28.6139",
    checkInLongitude: "77.2090",
    checkOutLatitude: null,
    checkOutLongitude: null,
    checkInAt: "2026-08-05T10:00:00.000Z",
    checkOutAt: null,
    durationMinutes: null,
    outcome: null,
    notes: null,
    ...overrides,
  };
}

describe("formatCoord", () => {
  it("rounds lat/lon to the display precision for the GPS column (GAP-FIELD-VISITS-03 PII)", () => {
    // Deliberate contract change: coordinates are rounded (default 3 dp) so a
    // field worker's precise position is not shown/exported pinpoint-accurate.
    expect(formatCoord("28.6139", "77.2090")).toBe("28.614, 77.209");
    expect(formatCoord("28.6", "77.2")).toBe("28.600, 77.200");
    expect(formatCoord("28.6139", "77.2090", 1)).toBe("28.6, 77.2");
    expect(formatCoord(null, "77.2")).toBe("—");
  });
});

describe("visitStatus", () => {
  it("treats missing check-out as open", () => {
    expect(visitStatus(visit())).toBe("open");
    expect(visitStatus(visit({ checkOutAt: "2026-08-05T11:00:00.000Z", outcome: "completed" }))).toBe("completed");
  });
});

describe("visitDisplayStatus / openVisitHours (GAP-FIELD-VISITS-02)", () => {
  const now = new Date("2026-08-06T00:00:00.000Z");
  it("completed visits read as completed", () => {
    expect(visitDisplayStatus(visit({ checkOutAt: "2026-08-05T11:00:00.000Z" }), now)).toBe("completed");
  });
  it("a visit open < 12h is in progress (warn)", () => {
    // checked in 2026-08-05T20:00Z => 4h before now
    expect(visitDisplayStatus(visit({ checkInAt: "2026-08-05T20:00:00.000Z" }), now)).toBe("in progress");
  });
  it("a visit open > 12h is overdue (bad)", () => {
    // checked in 2026-08-05T10:00Z => 14h before now
    expect(visitDisplayStatus(visit({ checkInAt: "2026-08-05T10:00:00.000Z" }), now)).toBe("overdue");
    expect(openVisitHours(visit({ checkInAt: "2026-08-05T10:00:00.000Z" }), now)).toBe(14);
  });
  it("openVisitHours is null for completed visits", () => {
    expect(openVisitHours(visit({ checkOutAt: "2026-08-05T11:00:00.000Z" }), now)).toBeNull();
  });
});

describe("rankVisits", () => {
  it("keeps open visits above completed ones", () => {
    const ranked = rankVisits([
      visit({ id: "done", checkOutAt: "2026-08-05T11:00:00.000Z", checkInAt: "2026-08-05T12:00:00.000Z" }),
      visit({ id: "open", checkInAt: "2026-08-05T09:00:00.000Z" }),
    ]);
    expect(ranked.map((v) => v.id)).toEqual(["open", "done"]);
  });
});

describe("outcomeLabel", () => {
  it("title-cases snake_case outcomes (GAP-FIELD-VISITS-05)", () => {
    // Deliberate contract change: humanized (title-case) rather than merely
    // underscore-replaced lower-case.
    expect(outcomeLabel("partial_complete")).toBe("Partial Complete");
    expect(outcomeLabel("no_show")).toBe("No Show");
    expect(outcomeLabel(null)).toBe("—");
  });
});
