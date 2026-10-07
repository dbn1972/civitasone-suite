import { describe, it, expect } from "vitest";
import { isTaskOverdue, countOverdue } from "./overdue";
import type { MyApprovalItem } from "@/app/_data/loaders";

const NOW = Date.parse("2026-09-15T12:00:00Z");

function item(dueDate: string | null): MyApprovalItem {
  return {
    id: "x", taskId: "x", instanceName: "x", refType: "leave_app", refId: "r",
    instanceId: "i", module: "leave", status: "pending", assignedAt: "2026-09-01T00:00:00Z",
    dueDate, link: "/hr/leave/approvals",
  };
}

describe("overdue helper (GAP-APPROVALS-HOME-06)", () => {
  it("a due date strictly in the past is overdue; future/none is not", () => {
    expect(isTaskOverdue("2026-09-14T00:00:00Z", NOW)).toBe(true);
    expect(isTaskOverdue("2026-09-16T00:00:00Z", NOW)).toBe(false);
    expect(isTaskOverdue(null, NOW)).toBe(false);
    expect(isTaskOverdue("not-a-date", NOW)).toBe(false);
  });

  it("countOverdue equals the number of rows the row-level test would flag", () => {
    const items = [item("2026-09-10T00:00:00Z"), item("2026-09-20T00:00:00Z"), item(null), item("2026-09-01T00:00:00Z")];
    const expected = items.filter((i) => isTaskOverdue(i.dueDate, NOW)).length;
    expect(countOverdue(items, NOW)).toBe(expected);
    expect(countOverdue(items, NOW)).toBe(2);
  });
});
