/**
 * GAP-HR-EMPLOYEES-DETAIL-EDIT-05: assertEligibleManager (employee/manager-eligibility.ts)
 * -- the pure rule behind the generic PATCH route's and consumer's managerId
 * guard. Real-DB coverage of the wiring is in employee-manager-guard-real-db.test.ts.
 */
import { describe, it, expect } from "vitest";
import { assertEligibleManager, isSameEmployeeId, type ManagerLookup } from "../src/modules/employee/manager-eligibility.js";
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

/**
 * z.string().uuid() accepts upper-case hex and Postgres matches uuids
 * case-insensitively, so the same employee can arrive as "ABCD..." on the URL and
 * "abcd..." in the body. The self / cycle checks must not be fooled by that.
 */
describe("assertEligibleManager -- id case-insensitivity", () => {
  const E = globalThis.crypto.randomUUID(); // the employee being edited (lower-case)
  const M = globalThis.crypto.randomUUID();
  const MID = globalThis.crypto.randomUUID();
  // Like Postgres, the lookup resolves ids case-insensitively.
  const pg = (nodes: Record<string, Node>): ManagerLookup => async (id) => nodes[id.toLowerCase()] ?? null;

  it("refuses self when the employee id is upper-case and the manager id is lower-case", async () => {
    expect(await codeOf(assertEligibleManager(pg({}), E.toUpperCase(), E))).toBe("422:CYCLE_DETECTED");
  });

  it("refuses self when the employee id is lower-case and the manager id is upper-case", async () => {
    expect(await codeOf(assertEligibleManager(pg({}), E, E.toUpperCase()))).toBe("422:CYCLE_DETECTED");
  });

  it("refuses a direct loop when the manager row stores the employee id in a different case", async () => {
    const g = pg({
      [E]: { status: "confirmed", managerId: null },
      [M]: { status: "confirmed", managerId: E.toUpperCase() },
    });
    expect(await codeOf(assertEligibleManager(g, E, M))).toBe("422:CYCLE_DETECTED");
    expect(await codeOf(assertEligibleManager(g, E.toUpperCase(), M))).toBe("422:CYCLE_DETECTED");
    expect(await codeOf(assertEligibleManager(g, E, M.toUpperCase()))).toBe("422:CYCLE_DETECTED");
  });

  it("refuses a transitive loop reached through a differently-cased id", async () => {
    const g = pg({
      [E]: { status: "confirmed", managerId: null },
      [M]: { status: "confirmed", managerId: MID.toUpperCase() },
      [MID]: { status: "confirmed", managerId: E },
    });
    expect(await codeOf(assertEligibleManager(g, E.toUpperCase(), M))).toBe("422:CYCLE_DETECTED");
    expect(await codeOf(assertEligibleManager(g, E, M.toUpperCase()))).toBe("422:CYCLE_DETECTED");
  });

  it("still accepts an unrelated manager whose id is spelled in upper-case", async () => {
    const root = globalThis.crypto.randomUUID();
    const g = pg({
      [E]: { status: "confirmed", managerId: root },
      [root]: { status: "confirmed", managerId: null },
      [M]: { status: "confirmed", managerId: root.toUpperCase() },
    });
    expect(await codeOf(assertEligibleManager(g, E.toUpperCase(), M.toUpperCase()))).toBeNull();
  });

  it("does not hang on a pre-existing loop whose ids alternate in case", async () => {
    const x = globalThis.crypto.randomUUID();
    const y = globalThis.crypto.randomUUID();
    const g = pg({
      [E]: { status: "confirmed", managerId: null },
      [x]: { status: "confirmed", managerId: y.toUpperCase() },
      [y]: { status: "confirmed", managerId: x },
    });
    expect(await codeOf(assertEligibleManager(g, E, x))).toBeNull();
  });
});

describe("isSameEmployeeId", () => {
  const id = globalThis.crypto.randomUUID();
  it("matches regardless of case", () => {
    expect(isSameEmployeeId(id, id.toUpperCase())).toBe(true);
    expect(isSameEmployeeId(id.toUpperCase(), id)).toBe(true);
  });
  it("is false for different ids or a null / undefined side", () => {
    expect(isSameEmployeeId(id, globalThis.crypto.randomUUID())).toBe(false);
    expect(isSameEmployeeId(id, null)).toBe(false);
    expect(isSameEmployeeId(undefined, id)).toBe(false);
    expect(isSameEmployeeId(null, null)).toBe(false);
  });
});
