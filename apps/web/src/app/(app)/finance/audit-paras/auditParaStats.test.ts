import { describe, it, expect } from "vitest";
import { auditParaStats } from "./auditParaStats";

describe("auditParaStats (GAP-FINANCE-AUDIT-PARAS-03)", () => {
  it("one of each valid status: every card is 1 and the buckets sum to total", () => {
    const s = auditParaStats(["open", "responded", "settled", "escalated", "dropped"].map((status) => ({ status })));
    expect(s).toEqual({ total: 5, open: 1, responded: 1, settled: 1, escalated: 1, droppedOther: 1 });
  });
  it("an unknown status lands in Dropped / Other so Total always reconciles", () => {
    const s = auditParaStats([{ status: "foo" }, { status: "OPEN " }, { status: "dropped" }]);
    expect(s.open).toBe(1);
    expect(s.droppedOther).toBe(2);
    expect(s.open + s.responded + s.settled + s.escalated + s.droppedOther).toBe(s.total);
  });
});
