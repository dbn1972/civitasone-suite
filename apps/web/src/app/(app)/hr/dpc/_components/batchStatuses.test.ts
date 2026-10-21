import { describe, it, expect } from "vitest";
import { bucketPromotions, DPC_IN_FLIGHT_STATUSES } from "./batchStatuses";

// lifecycle.hrms_promotions_status_check (migration 0144) + the legacy values PromotionCard folds in
const DB_STATUSES = ["pending", "approved", "rejected", "cancelled", "pending_approval", "completed", "pending_effective"];
const LEGACY = ["dept_approved", "hr_approved", "finance_approved", "signed"];

describe("DPC batch status buckets (GAP-HR-DPC-02)", () => {
  it("every status lands in exactly one bucket, so the tiles add up to the total", () => {
    const rows = [...DB_STATUSES, ...LEGACY, "something_new"].map((status) => ({ status }));
    const b = bucketPromotions(rows);
    expect(b.initiated + b.inApproval + b.awaitingEffective + b.signed + b.cancelled + b.other).toBe(rows.length);
    expect(b.other).toBe(1); // only the unknown one
  });

  it("pending_approval and pending_effective -- the statuses the live workflow writes -- are no longer in no bucket", () => {
    const b = bucketPromotions([{ status: "pending_approval" }, { status: "pending_effective" }, { status: "pending_effective" }]);
    expect(b.inApproval).toBe(1);
    expect(b.awaitingEffective).toBe(2);
    expect(b.other).toBe(0);
  });

  it("the in-flight filter only names real, non-terminal statuses", () => {
    for (const s of DPC_IN_FLIGHT_STATUSES) expect(DB_STATUSES).toContain(s);
    expect(DPC_IN_FLIGHT_STATUSES).not.toContain("completed");
    expect(DPC_IN_FLIGHT_STATUSES).not.toContain("cancelled");
    expect(DPC_IN_FLIGHT_STATUSES).not.toContain("rejected");
    // the two statuses a live write really produces for a promotion that is still in flight
    expect(DPC_IN_FLIGHT_STATUSES).toContain("pending_approval");
    expect(DPC_IN_FLIGHT_STATUSES).toContain("pending_effective");
  });
});
