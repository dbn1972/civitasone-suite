import { describe, it, expect } from "vitest";
import { __test } from "./_data";

const { mapJourneys, mapExecutions, mapTriggers, mapAnalytics, mapStatusTotal } = __test;

describe("journeys _data typed mappers", () => {
  // GAP-JOURNEYS-ACTIVE-01/02, BUILDER-02: typed mappers read the service's
  // `{ data, meta }` envelope and the real field names, not a key-guessing
  // fallback chain.
  it("mapJourneys reads data[] with name, status, step count and updatedAt", () => {
    const rows = mapJourneys({
      data: [
        { id: "j1", name: "Welcome", status: "active", steps: [{}, {}], updatedAt: "2026-01-02T00:00:00.000Z" },
        { id: "j2", status: "draft" }, // no name → id fallback; no steps → 0
      ],
      meta: { page: 1, pageSize: 20, total: 2 },
    });
    expect(rows).toEqual([
      { id: "j1", name: "Welcome", status: "active", stepCount: 2, updatedAt: "2026-01-02T00:00:00.000Z" },
      { id: "j2", name: "j2", status: "draft", stepCount: 0, updatedAt: null },
    ]);
  });

  it("mapExecutions maps journeyId/profileId/currentStepIndex/status/dates", () => {
    const rows = mapExecutions({
      data: [
        { id: "e1", journeyId: "j1", profileId: "p1", status: "in_progress", currentStepIndex: 2, enrolledAt: "2026-01-01T00:00:00.000Z", completedAt: null },
      ],
    });
    expect(rows[0]).toEqual({
      id: "e1",
      journeyId: "j1",
      profileId: "p1",
      status: "in_progress",
      currentStepIndex: 2,
      enrolledAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
    });
  });

  it("mapTriggers maps triggerType/journeyId/status", () => {
    const rows = mapTriggers({ data: [{ id: "t1", journeyId: "j1", triggerType: "event_based", status: "active", updatedAt: null }] });
    expect(rows[0]).toMatchObject({ id: "t1", triggerType: "event_based", status: "active", journeyId: "j1" });
  });

  it("rows without an id are skipped (not rendered as bare placeholders)", () => {
    expect(mapExecutions({ data: [{ status: "enrolled" }] })).toEqual([]);
    expect(mapJourneys({ data: [{ name: "nameless" }] })).toEqual([]);
  });

  it("tolerates a bare array and a service that returned nothing", () => {
    expect(mapExecutions([{ id: "e1", status: "enrolled" }])).toHaveLength(1);
    expect(mapExecutions(undefined)).toEqual([]);
    expect(mapExecutions({})).toEqual([]);
  });

  // GAP-JOURNEYS-ANALYTICS-01: real funnel counts, distinct from the Active list.
  it("mapAnalytics derives total/running/completed/failed + byStatus from executions", () => {
    const a = mapAnalytics({
      data: [
        { id: "1", status: "in_progress" },
        { id: "2", status: "in_progress" },
        { id: "3", status: "completed" },
        { id: "4", status: "failed" },
        { id: "5", status: "enrolled" },
      ],
      meta: { total: 42 },
    });
    expect(a.total).toBe(42); // server total, not page length
    expect(a.running).toBe(3); // in_progress x2 + enrolled
    expect(a.completed).toBe(1);
    expect(a.failed).toBe(1);
    expect(a.byStatus[0]).toEqual({ status: "in_progress", count: 2 }); // sorted desc
  });

  it("mapStatusTotal uses the server-reported meta.total, not the page length", () => {
    expect(mapStatusTotal({ data: [{ id: "1", status: "in_progress" }], meta: { total: 57 } })).toBe(57);
  });

  it("mapStatusTotal falls back to the row count without meta", () => {
    expect(mapStatusTotal({ data: [{ id: "1", status: "enrolled" }, { id: "2", status: "enrolled" }] })).toBe(2);
  });
});
