/**
 * W1 SF-16 — unit test for shared/self-scope.ts (the single home of the
 * employee-readable self-scoping helpers). The employee link and the DB are
 * mocked: this pins the DECISION table of every helper; the real-DB route
 * tests (leave/attendance/medical/certifications/learning *-real-db) pin the
 * end-to-end behaviour.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastifyRequest } from "fastify";
import type { RequestContext } from "@civitasone/types";

const linked = vi.hoisted(() => ({ emp: undefined as { id: string } | undefined }));
const reports = vi.hoisted(() => ({ ids: [] as string[] }));

vi.mock("../modules/employee/actor-link.js", () => ({
  resolveEmployeeForActor: vi.fn(async () => linked.emp),
}));
vi.mock("../shared/db.js", () => ({
  // drizzle select(...).from(...).where(...) chain resolving to the report rows
  scopedRead: vi.fn(async () => reports.ids.map((id) => ({ id }))),
  sqlClient: { begin: vi.fn(async () => reports.ids.map((id) => ({ id }))) },
}));

import {
  resolveOwnEmployeeIdIfBareEmployee, resolveOwnEmployeeIdIfNonHr, resolveLearningReadTarget,
  resolveLeaveReadScope, resolveSelfOrReportsScopedEmployeeId, resolveSelfAndReportsScope,
  resolveOwnEmployeeIdUnlessHr,
} from "../shared/self-scope.js";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const REPORT = "33333333-3333-4333-8333-333333333333";
const ctxOf = (...roles: string[]): RequestContext =>
  ({ tenantId: "t", actorId: "a", roles, correlationId: "c" }) as unknown as RequestContext;
const req = {} as FastifyRequest;

beforeEach(() => { linked.emp = { id: ME }; reports.ids = [REPORT]; });

describe("resolveOwnEmployeeIdIfBareEmployee", () => {
  it("forces a bare employee onto their own id", async () => {
    expect(await resolveOwnEmployeeIdIfBareEmployee(ctxOf("employee"), req, OTHER)).toBe(ME);
  });
  it("fails closed (null) for an unlinked bare employee", async () => {
    linked.emp = undefined;
    expect(await resolveOwnEmployeeIdIfBareEmployee(ctxOf("employee"), req, OTHER)).toBeNull();
  });
  it("passes the requested id through for HR and manager (incl. undefined)", async () => {
    expect(await resolveOwnEmployeeIdIfBareEmployee(ctxOf("hr_officer"), req, OTHER)).toBe(OTHER);
    expect(await resolveOwnEmployeeIdIfBareEmployee(ctxOf("manager"), req, undefined)).toBeUndefined();
  });
  it("honours a caller-supplied HR role set (medical adds finance_officer)", async () => {
    expect(await resolveOwnEmployeeIdIfBareEmployee(ctxOf("finance_officer"), req, OTHER)).toBe(ME);
    expect(await resolveOwnEmployeeIdIfBareEmployee(ctxOf("finance_officer"), req, OTHER, ["finance_officer"])).toBe(OTHER);
  });
});

describe("resolveOwnEmployeeIdIfNonHr (write side)", () => {
  it("scopes a manager to themselves, lets HR through, fails closed when unlinked", async () => {
    expect(await resolveOwnEmployeeIdIfNonHr(ctxOf("manager"), req, OTHER)).toBe(ME);
    expect(await resolveOwnEmployeeIdIfNonHr(ctxOf("hr_admin"), req, OTHER)).toBe(OTHER);
    linked.emp = undefined;
    expect(await resolveOwnEmployeeIdIfNonHr(ctxOf("employee"), req, OTHER)).toBeNull();
  });
});

describe("resolveLearningReadTarget", () => {
  it("bare employee: always own id, whatever is requested", async () => {
    expect(await resolveLearningReadTarget(ctxOf("employee"), OTHER)).toBe(ME);
    expect(await resolveLearningReadTarget(ctxOf("employee"), undefined)).toBe(ME);
  });
  it("HR / manager: requested id, or own id when none requested", async () => {
    expect(await resolveLearningReadTarget(ctxOf("hr_admin"), OTHER)).toBe(OTHER);
    expect(await resolveLearningReadTarget(ctxOf("manager"), OTHER)).toBe(OTHER);
    expect(await resolveLearningReadTarget(ctxOf("manager"), undefined)).toBe(ME);
    expect(await resolveLearningReadTarget(ctxOf("hr_admin"), undefined)).toBe(ME);
  });
  it("fails closed (null) when nothing resolves — never the requested id of a non-privileged caller", async () => {
    linked.emp = undefined;
    expect(await resolveLearningReadTarget(ctxOf("employee"), OTHER)).toBeNull();
    expect(await resolveLearningReadTarget(ctxOf("manager"), undefined)).toBeNull();
  });
});

describe("resolveLeaveReadScope", () => {
  it("HR: requested as a one-element array, or undefined (tenant-wide) when none", async () => {
    expect(await resolveLeaveReadScope(ctxOf("hr_admin"), req, OTHER)).toEqual([OTHER]);
    expect(await resolveLeaveReadScope(ctxOf("hr_admin"), req, undefined)).toBeUndefined();
  });
  it("bare employee: own id only; [] when unlinked", async () => {
    expect(await resolveLeaveReadScope(ctxOf("employee"), req, OTHER)).toEqual([ME]);
    linked.emp = undefined;
    expect(await resolveLeaveReadScope(ctxOf("employee"), req, OTHER)).toEqual([]);
  });
  it("manager: a requested direct report, else every direct report; never a stranger or the whole tenant", async () => {
    expect(await resolveLeaveReadScope(ctxOf("manager"), req, REPORT)).toEqual([REPORT]);
    expect(await resolveLeaveReadScope(ctxOf("manager"), req, OTHER)).toEqual([REPORT]);
    expect(await resolveLeaveReadScope(ctxOf("manager"), req, undefined)).toEqual([REPORT]);
  });
});

describe("resolveSelfOrReportsScopedEmployeeId (attendance)", () => {
  it("HR passes requested through unchanged", async () => {
    expect(await resolveSelfOrReportsScopedEmployeeId(ctxOf("hr_officer"), OTHER)).toBe(OTHER);
    expect(await resolveSelfOrReportsScopedEmployeeId(ctxOf("hr_officer"), undefined)).toBeUndefined();
  });
  it("manager: [self, ...reports]; narrowed to a requested member; [] (deny) for a stranger or when unlinked", async () => {
    expect(await resolveSelfOrReportsScopedEmployeeId(ctxOf("manager"), undefined)).toEqual([ME, REPORT]);
    expect(await resolveSelfOrReportsScopedEmployeeId(ctxOf("manager"), REPORT)).toEqual([REPORT]);
    expect(await resolveSelfOrReportsScopedEmployeeId(ctxOf("manager"), OTHER)).toEqual([]);
    linked.emp = undefined;
    expect(await resolveSelfOrReportsScopedEmployeeId(ctxOf("manager"), undefined)).toEqual([]);
  });
  it("bare employee: own id, or null when unlinked", async () => {
    expect(await resolveSelfOrReportsScopedEmployeeId(ctxOf("employee"), OTHER)).toBe(ME);
    linked.emp = undefined;
    expect(await resolveSelfOrReportsScopedEmployeeId(ctxOf("employee"), OTHER)).toBeNull();
  });
});

describe("resolveSelfAndReportsScope (certifications)", () => {
  it("HR: null (no filter)", async () => {
    expect(await resolveSelfAndReportsScope(ctxOf("super_admin"))).toBeNull();
  });
  it("employee: [self]; manager: [self, ...reports]; unlinked: []", async () => {
    expect(await resolveSelfAndReportsScope(ctxOf("employee"))).toEqual([ME]);
    expect(await resolveSelfAndReportsScope(ctxOf("manager"))).toEqual([ME, REPORT]);
    linked.emp = undefined;
    expect(await resolveSelfAndReportsScope(ctxOf("manager"))).toEqual([]);
  });
});

describe("resolveOwnEmployeeIdUnlessHr (skills / work-summaries)", () => {
  it("HR: undefined (unrestricted); employee AND manager: own id; unlinked: null", async () => {
    expect(await resolveOwnEmployeeIdUnlessHr(ctxOf("hr_admin"))).toBeUndefined();
    expect(await resolveOwnEmployeeIdUnlessHr(ctxOf("employee"))).toBe(ME);
    expect(await resolveOwnEmployeeIdUnlessHr(ctxOf("manager"))).toBe(ME);
    linked.emp = undefined;
    expect(await resolveOwnEmployeeIdUnlessHr(ctxOf("manager"))).toBeNull();
  });
});
