import { describe, it, expect } from "vitest";
import { taskTitle, type T } from "./rowText";
import { buildRows, type InboxTask, type RefSummary } from "../_lib/inboxModel";

// W9: what an approvals row/toast says. Stub translator echoes key + values so the test is about
// which message and which values are chosen, not the wording.
const t: T = (key, values) => `${key}${values ? ` ${JSON.stringify(values)}` : ""}`;
const NOW = Date.parse("2026-11-05T06:30:00.000Z");

function task(over: Partial<InboxTask>): InboxTask {
  return { id: "t1", instanceId: "i1", name: "Review", status: "pending", refType: "leave_app", refId: "r1", dueAt: null, createdAt: new Date(NOW).toISOString(), ...over };
}
function leaveSummary(fields: RefSummary["fields"]): RefSummary {
  return { refType: "leave_app", refId: "r1", kind: "business", instanceId: "i1", instanceName: "Leave Approval Workflow", reference: null, amountMinor: null, fields, maker: { name: "Asha Verma", designation: null }, stage: { level: 1, of: 2, step: null }, raisedAt: new Date(NOW).toISOString() } as RefSummary;
}

describe("taskTitle (W9)", () => {
  it("leave with dates names type, days and the from/to dates", () => {
    const tk = task({});
    const [row] = buildRows([tk], [leaveSummary([{ key: "leaveType", value: "Casual Leave" }, { key: "days", value: "2" }, { key: "fromDate", value: "2026-11-12" }, { key: "toDate", value: "2026-11-13" }])], NOW);
    const title = taskTitle(t, row!);
    expect(title).toContain("taskTitleLeaveDates");
    expect(title).toContain("12 Nov 2026");
    expect(title).toContain("13 Nov 2026");
  });

  it("leave without dates keeps the earlier wording", () => {
    const [row] = buildRows([task({})], [leaveSummary([{ key: "leaveType", value: "Casual Leave" }, { key: "days", value: "2" }])], NOW);
    expect(taskTitle(t, row!)).toMatch(/^taskTitleLeave \{/);
  });

  it("an indent with no summary still names the indent number", () => {
    const tk = task({ refType: "procurement_indent", instanceName: "Procurement Indent Approval \u2014 IND/2026/0081" });
    const [row] = buildRows([tk], [], NOW);
    expect(taskTitle(t, row!)).toBe('taskTitle.indent {"ref":"IND/2026/0081"}');
  });
});
