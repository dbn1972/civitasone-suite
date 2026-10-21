import { describe, it, expect } from "vitest";
import { bucketStatusCounts, countByStatus, PENDING_STATUSES, REVIEWED_STATUSES } from "./statusBuckets";

// Every status appraisal.hrms_appraisals_status_check allows (migration 0153)
// plus the legacy values the page always listed.
const DB_STATUSES = [
  "pending", "in_review", "completed", "self_pending", "reporting_officer",
  "reviewing_officer", "accepting_authority", "disclosed", "representation", "finalised",
];
const LEGACY_STATUSES = ["approved", "accepted", "submitted"];

describe("work-summary status buckets (GAP-HR-WORK-SUMMARY-02)", () => {
  it("puts every status in exactly one bucket, so reviewed + pending + other === total", () => {
    const counts = Object.fromEntries([...DB_STATUSES, ...LEGACY_STATUSES, "unknown_x"].map((s, i) => [s, i + 1]));
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const b = bucketStatusCounts(counts);
    expect(b.reviewed + b.pending + b.other).toBe(total);
  });

  it("the reviewed and pending lists never overlap", () => {
    expect(REVIEWED_STATUSES.filter((s) => PENDING_STATUSES.includes(s))).toEqual([]);
  });

  it("classifies the real workflow statuses", () => {
    expect(bucketStatusCounts({ completed: 2, finalised: 1 })).toEqual({ reviewed: 3, pending: 0, other: 0 });
    expect(bucketStatusCounts({ pending: 1, self_pending: 1 })).toEqual({ reviewed: 0, pending: 2, other: 0 });
    expect(bucketStatusCounts({ reporting_officer: 1, reviewing_officer: 1, accepting_authority: 1, in_review: 1, disclosed: 1, representation: 1 }))
      .toEqual({ reviewed: 0, pending: 0, other: 6 });
  });

  it("countByStatus tallies rows by status", () => {
    expect(countByStatus([{ status: "a" }, { status: "b" }, { status: "a" }])).toEqual({ a: 2, b: 1 });
  });
});
