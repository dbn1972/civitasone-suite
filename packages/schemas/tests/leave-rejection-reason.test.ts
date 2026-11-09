import { describe, expect, it } from "vitest";
import { LeaveRequestDetailListSchema, LeaveRequestPageSchema } from "../src/web.js";

// W8: sendValidated() parses with these schemas, and zod strips unknown keys, so a field missing
// here never reaches the browser.
const row = (over: Record<string, unknown> = {}) => ({
  id: "l-1", employeeId: "e-1", employeeName: "Asha Verma", leaveType: "Casual Leave",
  fromDate: "2026-09-01", toDate: "2026-09-02", days: 2, status: "rejected", appliedAt: "2026-08-28T05:00:00.000Z", ...over,
});

describe("leave request schemas carry rejectionReason (W8)", () => {
  it("keeps the approver reason on a rejected row (list and page)", () => {
    const reason = "Audit closing week, please reapply after 5 October";
    expect(LeaveRequestDetailListSchema.parse([row({ rejectionReason: reason })])[0]!.rejectionReason).toBe(reason);
    const page = LeaveRequestPageSchema.parse({ data: [row({ rejectionReason: reason })], meta: { page: 1, pageSize: 50, offset: 0, total: 1, hasMore: false, statusCounts: { rejected: 1 } } });
    expect(page.data[0]!.rejectionReason).toBe(reason);
  });

  it("accepts rows with no reason (pre-deploy rejections, other statuses) as absent or null", () => {
    expect(() => LeaveRequestDetailListSchema.parse([row(), row({ rejectionReason: null }), row({ status: "approved" })])).not.toThrow();
  });
});
