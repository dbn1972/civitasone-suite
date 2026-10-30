import { describe, it, expect } from "vitest";
import { countByBucket, bucketOf } from "./statusCounts";

// GAP-CITIZEN-GRIEVANCES-04 (owner decision D4c #2): /citizen/grievances is the official
// register and /citizen/requests is the all-requests view; both count through this one helper
// so the same dataset always yields the same numbers.
describe("citizen status-count helper", () => {
  it("maps every known status to exactly one bucket, case-insensitively", () => {
    for (const s of ["submitted", "pending", "registered", "under_review", "assigned", "in_progress", "PENDING"]) {
      expect(bucketOf(s)).toBe("open");
    }
    for (const s of ["resolved", "closed", "disposed", "Resolved"]) expect(bucketOf(s)).toBe("resolved");
    expect(bucketOf("escalated")).toBe("escalated");
    expect(bucketOf("rejected")).toBe("rejected");
    expect(bucketOf("something_new")).toBeNull();
  });

  it("counts a dataset by bucket; unknown statuses count only toward total", () => {
    const rows = [
      { status: "pending" }, { status: "in_progress" }, { status: "escalated" },
      { status: "resolved" }, { status: "closed" }, { status: "rejected" }, { status: "weird" },
    ];
    expect(countByBucket(rows)).toEqual({ total: 7, open: 2, escalated: 1, resolved: 2, rejected: 1 });
  });
});
