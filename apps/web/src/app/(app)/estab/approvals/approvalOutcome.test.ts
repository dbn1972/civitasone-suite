import { describe, it, expect } from "vitest";
import { outcomeFromInstanceTasks } from "./approvalOutcome";

const T = "t-1";

describe("outcomeFromInstanceTasks (GAP-ESTAB-APPROVALS-05)", () => {
  it("is null while the approver's task has not completed (still being applied)", () => {
    expect(outcomeFromInstanceTasks([{ id: T, status: "pending", roleRef: "r" }], T)).toBeNull();
  });

  it("is null when the task is not in the list at all", () => {
    expect(outcomeFromInstanceTasks([{ id: "other", status: "completed" }], T)).toBeNull();
    expect(outcomeFromInstanceTasks([], T)).toBeNull();
  });

  it("is final when the task completed and nothing else is pending", () => {
    expect(outcomeFromInstanceTasks([
      { id: "earlier", status: "completed", roleRef: "a" },
      { id: T, status: "completed", roleRef: "b" },
    ], T)).toEqual({ kind: "final" });
  });

  it("is forwarded, naming each pending role once, when another step is open", () => {
    expect(outcomeFromInstanceTasks([
      { id: T, status: "completed", roleRef: "b" },
      { id: "n1", status: "pending", roleRef: "estab_deputy_secretary" },
      { id: "n2", status: "pending", roleRef: "estab_deputy_secretary" },
      { id: "n3", status: "pending", roleRef: "estab_secretary" },
    ], T)).toEqual({ kind: "forwarded", roles: ["estab_deputy_secretary", "estab_secretary"] });
  });

  it("is forwarded with no role when the open step has no role", () => {
    expect(outcomeFromInstanceTasks([
      { id: T, status: "completed" },
      { id: "n1", status: "pending", roleRef: null },
    ], T)).toEqual({ kind: "forwarded", roles: [] });
  });

  it("ignores tasks that are neither this one nor pending (cancelled, completed)", () => {
    expect(outcomeFromInstanceTasks([
      { id: T, status: "completed" },
      { id: "x", status: "cancelled", roleRef: "r" },
      { id: "y", status: "completed", roleRef: "r" },
    ], T)).toEqual({ kind: "final" });
  });

  it("never reads a role or task name to decide: the same states give the same result for any role", () => {
    const a = outcomeFromInstanceTasks([{ id: T, status: "completed", roleRef: "estab_deputy_secretary" }], T);
    const b = outcomeFromInstanceTasks([{ id: T, status: "completed", roleRef: "anything_renamed" }], T);
    expect(a).toEqual(b);
  });
});
