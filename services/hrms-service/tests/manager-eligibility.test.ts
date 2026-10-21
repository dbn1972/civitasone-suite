/**
 * GAP-HR-EMPLOYEES-DETAIL-EDIT-05: assertEligibleManager (employee/manager-eligibility.ts)
 * -- the pure rule behind the generic PATCH route's and consumer's managerId
 * guard. Real-DB coverage of the wiring is in employee-manager-guard-real-db.test.ts.
 */
import { describe, it, expect } from "vitest";
import { assertEligibleManager, type ManagerLookup } from "../src/modules/employee/manager-eligibility.js";
import { HttpError } from "../src/shared/context.js";

type Node = { status: string; managerId: string | null };
const graph = (nodes: Record<string, Node>): ManagerLookup => async (id) => nodes[id] ?? null;

async function codeOf(p: Promise<void>): Promise<string | null> {
  try { await p; return null; } catch (e) { return e instanceof HttpError ? `${e.status}:${e.code}` : String(e); }
}

describe("assertEligibleManager", () => {
  it("refuses an employee as their own manager", async () => {
    expect(await codeOf(assertEligibleManager(graph({}), "a", "a"))).toBe("422:CYCLE_DETECTED");
  });

  it("refuses a manager who does not exist", async () => {
    expect(await codeOf(assertEligibleManager(graph({ a: { status: "confirmed", managerId: null } }), "a", "ghost"))).toBe("422:INVALID_MANAGER");
  });

  it.each(["terminated", "separated", "retired"])("refuses an exited manager (%s)", async (status) => {
    const g = graph({ a: { status: "confirmed", managerId: null }, m: { status, managerId: null } });
    expect(await codeOf(assertEligibleManager(g, "a", "m"))).toBe("422:INVALID_MANAGER");
  });

  it.each(["probation", "confirmed", "on_leave", "suspended", "deputation"])("accepts a manager whose status is %s", async (status) => {
    const g = graph({ a: { status: "confirmed", managerId: null }, m: { status, managerId: null } });
    expect(await codeOf(assertEligibleManager(g, "a", "m"))).toBeNull();
  });

  it("refuses a direct loop (the proposed manager already reports to the employee)", async () => {
    const g = graph({ a: { status: "confirmed", managerId: null }, m: { status: "confirmed", managerId: "a" } });
    expect(await codeOf(assertEligibleManager(g, "a", "m"))).toBe("422:CYCLE_DETECTED");
  });

  it("refuses a transitive loop several levels up", async () => {
    const g = graph({
      a: { status: "confirmed", managerId: null },
      b: { status: "confirmed", managerId: "a" },
      c: { status: "confirmed", managerId: "b" },
      d: { status: "confirmed", managerId: "c" },
    });
    expect(await codeOf(assertEligibleManager(g, "a", "d"))).toBe("422:CYCLE_DETECTED");
  });

  it("accepts a manager in a different branch of the tree", async () => {
    const g = graph({
      a: { status: "confirmed", managerId: "root" },
      root: { status: "confirmed", managerId: null },
      m: { status: "confirmed", managerId: "root" },
    });
    expect(await codeOf(assertEligibleManager(g, "a", "m"))).toBeNull();
  });

  it("does not hang or blame this assignment for a PRE-EXISTING loop elsewhere in the chain", async () => {
    const g = graph({
      a: { status: "confirmed", managerId: null },
      x: { status: "confirmed", managerId: "y" },
      y: { status: "confirmed", managerId: "x" },
    });
    expect(await codeOf(assertEligibleManager(g, "a", "x"))).toBeNull();
  });

  it("stops walking after the depth cap rather than looping forever on a very deep chain", async () => {
    const nodes: Record<string, Node> = { a: { status: "confirmed", managerId: null } };
    for (let i = 0; i < 200; i++) nodes[`n${i}`] = { status: "confirmed", managerId: i === 199 ? null : `n${i + 1}` };
    expect(await codeOf(assertEligibleManager(graph(nodes), "a", "n0"))).toBeNull();
  });
});
