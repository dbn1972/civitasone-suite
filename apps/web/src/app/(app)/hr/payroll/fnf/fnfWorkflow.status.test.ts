import { describe, it, expect } from "vitest";
import { fnfStatusBucket } from "./fnfWorkflow";

// GAP-PAYROLL-FNF-04: every status the payroll-service workflow can write lands in exactly one bucket.
const API_STATUSES = ["draft", "computed", "submitted", "finance_approved", "disbursed", "rejected", "pending", "settled", "paid"];

describe("fnfStatusBucket (GAP-PAYROLL-FNF-04)", () => {
  it("maps every workflow status to a bucket", () => {
    expect(fnfStatusBucket("computed")).toBe("pending");
    expect(fnfStatusBucket("draft")).toBe("pending");
    expect(fnfStatusBucket("rejected")).toBe("pending");
    expect(fnfStatusBucket("submitted")).toBe("inApproval");
    expect(fnfStatusBucket("finance_approved")).toBe("inApproval");
    expect(fnfStatusBucket("disbursed")).toBe("settled");
  });
  it("buckets partition the status set (counts sum to total) and an unknown status is not dropped", () => {
    const all = [...API_STATUSES, "mystery"];
    const counts = { pending: 0, inApproval: 0, settled: 0 };
    for (const s of all) counts[fnfStatusBucket(s)] += 1;
    expect(counts.pending + counts.inApproval + counts.settled).toBe(all.length);
    expect(fnfStatusBucket("mystery")).toBe("pending");
  });
});
