import { describe, it, expect, vi } from "vitest";

// W8: the leave-requests DTO exposes rejectionReason for rejected rows only.
vi.mock("../../shared/infra.js", () => ({
  cache: { listOrLoad: async (_t: string, _r: string, _k: string, load: () => Promise<unknown>) => load(), makeKey: () => "k", getOrLoad: async (_k: string, load: () => Promise<unknown>) => load() },
}));
vi.mock("./repo.js", () => ({
  findLeaveAppsByTenant: vi.fn(),
  listLeaveTypesByTenant: vi.fn(async () => [{ id: "lt-1", name: "Casual Leave" }]),
}));
vi.mock("../employee/repo.js", () => ({ listByIds: vi.fn(async () => [{ id: "e-1", fullName: "Asha Verma" }]), findById: vi.fn() }));
vi.mock("../../shared/batch-resolve.js", () => ({ batchEmployees: vi.fn() }));

import * as repo from "./repo.js";
import { listLeaveRequestDetails } from "./queries.js";

const base = { employeeId: "e-1", leaveTypeId: "lt-1", fromDate: "2026-09-01", toDate: "2026-09-02", daysApplied: 2, daysAppliedExact: null, dayPart: "full", reason: "family", approvedBy: null, createdAt: new Date("2026-08-28T05:00:00Z") };

describe("listLeaveRequestDetails rejectionReason gating (W8)", () => {
  it("returns the reason for rejected rows and drops it for any other status", async () => {
    vi.mocked(repo.findLeaveAppsByTenant).mockResolvedValue([
      { ...base, id: "a", status: "rejected", rejectionReason: "Audit closing week" },
      { ...base, id: "b", status: "rejected", rejectionReason: null },
      { ...base, id: "c", status: "approved", rejectionReason: "stale" },
    ] as never);
    const rows = (await listLeaveRequestDetails("t-1", 50)) as Array<{ id: string; rejectionReason?: string }>;
    expect(rows.find((r) => r.id === "a")!.rejectionReason).toBe("Audit closing week");
    expect(rows.find((r) => r.id === "b")!.rejectionReason).toBeUndefined();
    expect(rows.find((r) => r.id === "c")!.rejectionReason).toBeUndefined();
  });
});
