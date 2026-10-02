/**
 * Unit tests for shared/employee-scope.ts -- the ownership guard every payroll
 * self-service route uses (payslip PDF/download SEC-P1-01/02, loans
 * SEC-P2-01, tax/Form 16/12BA C1, tax advisor SEC-P2-02).
 *
 * ctx.actorId (login user id) and payroll employee ids (hrms employee UUIDs)
 * are DIFFERENT id spaces, so the mocked resolver maps the actor to a
 * different id: a guard that compared actorId directly would fail these.
 * Route-level coverage: tests/payroll-ownership-idspace.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RequestContext } from "@civitasone/types";

const H = vi.hoisted(() => ({ down: false, linked: true }));
const ACTOR = "22222222-2222-2222-2222-222222222222";
const OWN = "44444444-4444-4444-4444-444444444444";
const OTHER = "33333333-3333-3333-3333-333333333333";

vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return {
    ...actual,
    resolveActorEmployeeId: vi.fn(async () => {
      if (H.down) throw new actual.HrmsUnavailableError("down");
      return H.linked ? OWN : null;
    }),
  };
});

const { scopeEmployeeId, requireOwnEmployeeId, isRouteStaff, staffRolesOf } = await import("../src/shared/employee-scope.js");
const { HttpError } = await import("../src/shared/context.js");
const { resolveActorEmployeeId } = await import("../src/shared/hrms-client.js");

const READER_ROLES = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer", "employee"];
const STAFF = staffRolesOf(READER_ROLES);
const NO_FINANCE_STAFF = ["payroll_admin", "payroll_officer", "super_admin", "hr_admin"];

function ctx(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    tenantId: "11111111-1111-1111-1111-111111111111",
    actorId: ACTOR,
    actorType: "user",
    roles: ["employee"],
    correlationId: "c1",
    ...overrides,
  };
}

async function status(p: Promise<unknown>): Promise<number> {
  try { await p; return 0; } catch (e) { expect(e).toBeInstanceOf(HttpError); return (e as InstanceType<typeof HttpError>).status; }
}

beforeEach(() => { H.down = false; H.linked = true; vi.mocked(resolveActorEmployeeId).mockClear(); });

describe("employee-scope: self-service employee", () => {
  it("is pinned to their resolved hrms employee id, not their actorId", async () => {
    expect(await scopeEmployeeId(ctx(), undefined, STAFF)).toBe(OWN);
    expect(await scopeEmployeeId(ctx(), OWN, STAFF)).toBe(OWN);
  });

  it("naming their own actorId (wrong id space) or a co-worker is 403", async () => {
    expect(await status(scopeEmployeeId(ctx(), ACTOR, STAFF))).toBe(403);
    expect(await status(scopeEmployeeId(ctx(), OTHER, STAFF))).toBe(403);
  });

  it("fails closed: HRMS unreachable is 502, unlinked user is 403", async () => {
    H.down = true;
    expect(await status(requireOwnEmployeeId(ctx()))).toBe(502);
    H.down = false; H.linked = false;
    expect(await status(scopeEmployeeId(ctx(), undefined, STAFF))).toBe(403);
  });
});

describe("employee-scope: staff decided by the ROUTE's own staff roles", () => {
  it("staffRolesOf drops only the employee role", () => {
    expect(STAFF).toEqual(["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"]);
  });

  it("a payroll_officer acts on behalf of any employee without an identity lookup", async () => {
    expect(await scopeEmployeeId(ctx({ roles: ["payroll_officer"] }), OTHER, STAFF)).toBe(OTHER);
    expect(resolveActorEmployeeId).not.toHaveBeenCalled();
  });

  it("staff must name an employee (400)", async () => {
    expect(await status(scopeEmployeeId(ctx({ roles: ["payroll_admin"] }), undefined, STAFF))).toBe(400);
  });

  it("an employee who also holds a staff role of the route is not confined", async () => {
    expect(await scopeEmployeeId(ctx({ roles: ["employee", "hr_admin"] }), OTHER, STAFF)).toBe(OTHER);
  });

  it("finance_officer+employee is confined where the route's staff roles exclude finance_officer", async () => {
    const dual = ctx({ roles: ["finance_officer", "employee"] });
    expect(isRouteStaff(dual, NO_FINANCE_STAFF)).toBe(false);
    expect(await status(scopeEmployeeId(dual, OTHER, NO_FINANCE_STAFF))).toBe(403);
    expect(await scopeEmployeeId(dual, OWN, NO_FINANCE_STAFF)).toBe(OWN);
    // ...and keeps staff access where the route does admit finance_officer.
    expect(await scopeEmployeeId(dual, OTHER, STAFF)).toBe(OTHER);
  });

  it("a service account is not confined (passes through, 400 when missing)", async () => {
    const svc = ctx({ actorType: "service_account", roles: ["employee"] });
    expect(await scopeEmployeeId(svc, OTHER, STAFF)).toBe(OTHER);
    expect(await status(scopeEmployeeId(svc, undefined, STAFF))).toBe(400);
  });
});
