import { describe, it, expect } from "vitest";
import { mapEmployees } from "./loaders";

// THE REPORTED BUG: /hr/dashboard showed a page-level "Couldn't load —
// showing nothing" banner and its employee table showed "We couldn't load
// employees," even though GET /api/v1/hrms/dashboard (the other loader on
// the same page, via Promise.all in page.tsx) returned a clean 200. Root
// cause isolated by running hrms-service's real Fastify app in-process
// (buildApp().inject()) against a disposable, freshly-migrated Postgres:
// GET /v1/hrms/employees itself is correct -- it returns 200 with
// {data: [], pagination: {hasMore:false, pageSize:8}} for an empty tenant
// (the exact tenant shape GET /v1/hrms/dashboard reported headcount:0 for)
// and 200 with real rows for a seeded tenant. The bug is entirely
// client-side: mapEmployees (this file's getEmployees(), consumed by
// hr/dashboard/page.tsx) used to `return mapped.length > 0 ? mapped :
// null`. fetchJson (apiClient.ts) treats a null mapResponse return as
// source:"error" (invalid_payload) -- indistinguishable from a real fetch
// failure -- so every empty-tenant employee list rendered as a load error
// instead of the correct "no employees yet" state. Same regression as
// mapContractsListRows (fixup commit b6bd6740 / PR #813) and the generic
// mapModuleRows (loaders.moduleRows.test.ts) -- this is that identical bug,
// independently present in mapEmployees.
//
// SAMPLE_ROW and the empty envelope below are not synthetic: both are the
// real response bodies captured from hrms-service's own real Fastify app
// (GET /v1/hrms/employees, HS256 test JWT, hr_admin role) run in-process
// against a disposable Postgres freshly migrated from
// services/hrms-service/migrations/*.sql -- confirming these exact shapes
// are what reaches mapEmployees in production.
const SAMPLE_ROW = {
  id: "eeeeeeee-1487-4000-8000-0000000000e2",
  employeeNo: "HRDASH-001",
  name: "Regression Test Employee",
  department: "HR Dashboard Test Dept",
  employeeType: "permanent",
  status: "probation",
};

describe("mapEmployees", () => {
  it("maps a real employee row", () => {
    expect(mapEmployees({ data: [SAMPLE_ROW], pagination: { hasMore: false, pageSize: 8 } })).toEqual([
      {
        id: "eeeeeeee-1487-4000-8000-0000000000e2",
        employeeNo: "HRDASH-001",
        name: "Regression Test Employee",
        department: "HR Dashboard Test Dept",
        status: "probation",
      },
    ]);
  });

  it("returns an empty array (not null) for a tenant with zero employees", () => {
    // This is the exact regression: mapEmployees used to return
    // `mapped.length > 0 ? mapped : null` here, which fetchJson turns into
    // source:"error" -- the page-level "Couldn't load" banner and the
    // employee table's "We couldn't load employees" state, for a tenant
    // that genuinely just has no employees yet.
    const REAL_EMPTY_ENVELOPE = { data: [], pagination: { hasMore: false, pageSize: 8 } };
    const result = mapEmployees(REAL_EMPTY_ENVELOPE);
    expect(result).toEqual([]);
    expect(result).not.toBeNull();
  });

  it("accepts a bare array payload (no envelope)", () => {
    expect(mapEmployees([SAMPLE_ROW])).toHaveLength(1);
  });

  it("falls back to empCode for id/employeeNo and to \"—\" for a missing department", () => {
    expect(mapEmployees({ data: [{ empCode: "E-9", name: "No Dept Yet" }] })).toEqual([
      { id: "E-9", employeeNo: "E-9", name: "No Dept Yet", department: "—", status: "probation" },
    ]);
  });

  it("skips rows missing both id and name, without throwing", () => {
    const result = mapEmployees({
      data: [{ id: "missing-name" }, { name: "missing-id" }, SAMPLE_ROW],
    });
    expect(result).toHaveLength(1);
    expect(result?.[0]?.id).toBe(SAMPLE_ROW.id);
  });

  it("returns null for a payload that isn't a recognizable row list at all", () => {
    expect(mapEmployees(null)).toBeNull();
    expect(mapEmployees("not json")).toBeNull();
    expect(mapEmployees({ unrelated: true })).toBeNull();
  });
});
