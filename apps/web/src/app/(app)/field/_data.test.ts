import { describe, it, expect } from "vitest";
import {
  mapTasks,
  mapRoutesDetailed,
  mapAgentRows,
  fieldSyncPullPath,
  fieldSyncWindowNote,
  FIELD_SYNC_WINDOW_DAYS,
  FIELD_SYNC_LIMIT,
} from "./_data";

describe("mapTasks (GAP-FIELD-TASKS-03/05)", () => {
  it("maps task view fields incl. assignee, due and status; groups one row per task", () => {
    const payload = {
      data: [
        { id: "t1", title: "Inspect pole", taskType: "inspection", assigneeId: "agent-9", status: "assigned", priority: 2, dueDate: "2026-09-30T10:00:00.000Z" },
        { id: "t2", taskType: "survey", status: "unassigned" },
      ],
    };
    const rows = mapTasks(payload);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: "t1", title: "Inspect pole", assignee: "agent-9", status: "assigned", dueDate: "2026-09-30T10:00:00.000Z" });
    // unassigned task falls back cleanly
    expect(rows[1]).toMatchObject({ id: "t2", title: "survey", assignee: "Unassigned", status: "unassigned", dueDate: null });
  });
});

describe("mapRoutesDetailed (GAP-FIELD-ROUTES-02/04)", () => {
  it("surfaces stop count, distance, agent and duration", () => {
    const payload = {
      data: [
        {
          id: "r1",
          assigneeId: "agent-1",
          routeDate: "2026-09-28",
          status: "draft",
          waypoints: [{ taskId: "a" }, { taskId: "b" }, { taskId: "c" }],
          totalDistanceKm: "12.50",
          estimatedDurationMinutes: 95,
        },
      ],
    };
    const rows = mapRoutesDetailed(payload);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "r1", agent: "agent-1", status: "draft", stopCount: 3, distanceKm: "12.50", durationMinutes: 95 });
  });
});

describe("mapAgentRows (GAP-FIELD-AGENTS-01/04)", () => {
  it("maps one row per agent with a task count", () => {
    const payload = { data: [{ agentId: "a1", taskCount: 2 }, { agentId: "a2", taskCount: 5 }] };
    const rows = mapAgentRows(payload);
    expect(rows).toEqual([
      { agentId: "a1", taskCount: 2 },
      { agentId: "a2", taskCount: 5 },
    ]);
  });
});

describe("fieldSyncPullPath (GAP-FIELD-SYNC-01)", () => {
  it("uses a recent `since` within the window and an explicit limit, not the 1970 epoch", () => {
    const now = new Date("2026-10-06T12:00:00.000Z");
    const path = fieldSyncPullPath(now);
    expect(path).toContain(`limit=${FIELD_SYNC_LIMIT}`);
    expect(path).not.toContain("1970");
    const sinceMatch = /since=([^&]+)/.exec(path);
    expect(sinceMatch).not.toBeNull();
    const since = new Date(decodeURIComponent(sinceMatch![1]));
    const expected = new Date(now.getTime() - FIELD_SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    expect(since.toISOString()).toBe(expected.toISOString());
    // within 8 days of "now" (sanity)
    expect(now.getTime() - since.getTime()).toBeLessThanOrEqual(8 * 24 * 60 * 60 * 1000);
  });
});

describe("fieldSyncWindowNote (GAP2-FIELD-SYNC-WINDOW-01)", () => {
  it("states the cap and the server total when there are more pending changes than shown", () => {
    const note = fieldSyncWindowNote({ shown: 100, total: 342, windowDays: FIELD_SYNC_WINDOW_DAYS, limit: FIELD_SYNC_LIMIT });
    expect(note).toContain("100 of 342");
    expect(note).toContain(`last ${FIELD_SYNC_WINDOW_DAYS} days`);
    expect(note).toMatch(/not shown/i);
  });

  it("warns the window may be partial when the page is full but no total was returned", () => {
    const note = fieldSyncWindowNote({ shown: FIELD_SYNC_LIMIT, total: null, windowDays: FIELD_SYNC_WINDOW_DAYS, limit: FIELD_SYNC_LIMIT });
    expect(note).toContain(`first ${FIELD_SYNC_LIMIT} shown`);
    expect(note).toMatch(/may be more/i);
  });

  it("states a plain count when the full pending set fits in the window", () => {
    const note = fieldSyncWindowNote({ shown: 3, total: 3, windowDays: FIELD_SYNC_WINDOW_DAYS, limit: FIELD_SYNC_LIMIT });
    expect(note).toContain("3 shown");
    expect(note).not.toMatch(/not shown|may be more/i);
  });
});
