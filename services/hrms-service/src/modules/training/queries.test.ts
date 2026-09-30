/**
 * GAP-HR-TRAINING-02/05 — listTrainingPrograms unit tests.
 *
 * Covers:
 *  - category/mode/enrollmentDeadline pass through as the row's real value,
 *    or null -- queries.ts must never hard-code 'general' (GAP-HR-TRAINING-02)
 *    or synthesize a value the web layer would otherwise have guessed.
 *  - status is computed against IST "today", not a UTC calendar date (a
 *    training starting "today" in India must read "ongoing", not
 *    "upcoming", even when it is still "yesterday" in UTC) (GAP-HR-TRAINING-05).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { listOrLoadMock, listTrainingsByTenantMock, countNominationsByTrainingMock } = vi.hoisted(() => ({
  listOrLoadMock: vi.fn(async (_tenantId: string, _resource: string, _hash: string, loader: () => Promise<unknown>) => loader()),
  listTrainingsByTenantMock: vi.fn(),
  countNominationsByTrainingMock: vi.fn(),
}));

vi.mock("../../shared/infra.js", () => ({
  cache: { listOrLoad: listOrLoadMock },
}));
vi.mock("./repo.js", () => ({
  listTrainingsByTenant: listTrainingsByTenantMock,
  countNominationsByTraining: countNominationsByTrainingMock,
}));

const { listTrainingPrograms } = await import("./queries.js");

describe("listTrainingPrograms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    countNominationsByTrainingMock.mockResolvedValue(new Map());
  });

  it("passes through the row's real category/mode/enrollmentDeadline, never a hard-coded default", async () => {
    listTrainingsByTenantMock.mockResolvedValue([
      {
        id: "t1", title: "Real Category Training", facilitator: null, venue: null,
        fromDate: "2020-01-01", toDate: "2020-01-02", maxParticipants: 30, status: "planned",
        category: "leadership", mode: "blended", enrollmentDeadline: "2019-12-25",
      },
      {
        id: "t2", title: "Unset Category Training", facilitator: null, venue: null,
        fromDate: "2020-01-01", toDate: "2020-01-02", maxParticipants: 30, status: "planned",
        category: null, mode: null, enrollmentDeadline: null,
      },
    ]);

    const rows = await listTrainingPrograms("tenant-1", 100);

    expect(rows[0]!.category).toBe("leadership");
    expect(rows[0]!.mode).toBe("blended");
    expect(rows[0]!.enrollmentDeadline).toBe("2019-12-25");

    // GAP-HR-TRAINING-02: an unset category must render null (no badge),
    // never the old hard-coded 'general' (which the web layer then
    // defaulted to a red "Mandatory" badge for anything it didn't recognise).
    expect(rows[1]!.category).toBeNull();
    expect(rows[1]!.category).not.toBe("general");
    expect(rows[1]!.mode).toBeNull();
    expect(rows[1]!.enrollmentDeadline).toBeNull();
  });

  it("treats a training starting 'today' in IST as ongoing even when it is still 'yesterday' in UTC", async () => {
    // 2026-05-04T19:00:00Z is 2026-05-05T00:30 IST (UTC+5:30) -- past
    // midnight in India, still the 4th in UTC.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-04T19:00:00.000Z"));

    listTrainingsByTenantMock.mockResolvedValue([
      {
        id: "t3", title: "Starts Today In IST", facilitator: null, venue: null,
        fromDate: "2026-05-05", toDate: "2026-05-06", maxParticipants: 30, status: "planned",
        category: null, mode: null, enrollmentDeadline: null,
      },
    ]);

    const rows = await listTrainingPrograms("tenant-1", 100);
    expect(rows[0]!.status).toBe("ongoing");

    vi.useRealTimers();
  });
});
