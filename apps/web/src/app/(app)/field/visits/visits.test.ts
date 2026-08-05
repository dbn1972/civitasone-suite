import { describe, it, expect } from "vitest";
import { formatCoord, outcomeLabel, rankVisits, visitStatus, type FieldVisit } from "./visits";

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
  it("joins lat/lon for the GPS column", () => {
    expect(formatCoord("28.6", "77.2")).toBe("28.6, 77.2");
    expect(formatCoord(null, "77.2")).toBe("—");
  });
});

describe("visitStatus", () => {
  it("treats missing check-out as open", () => {
    expect(visitStatus(visit())).toBe("open");
    expect(visitStatus(visit({ checkOutAt: "2026-08-05T11:00:00.000Z", outcome: "completed" }))).toBe("completed");
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
  it("humanises snake_case outcomes", () => {
    expect(outcomeLabel("partial_complete")).toBe("partial complete");
    expect(outcomeLabel(null)).toBe("—");
  });
});
