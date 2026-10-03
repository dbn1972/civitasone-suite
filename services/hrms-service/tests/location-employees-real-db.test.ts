/**
 * GAP-HR-LOCATIONS-03 (real Postgres): GET /v1/hrms/locations/:locationId/employees
 * -- the tenant's employees assigned to one location.
 *
 * Covers tenant isolation, paging/total, stable (name, id) order, the
 * include-sub-locations option (location-service answer stubbed at the fetch
 * boundary -- hrms never reads another service's schema), the HR role gate,
 * the active/status filter, search, the unlinked free-text count, and that no
 * PII column ever leaves the response.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";
import type { FastifyInstance } from "fastify";

const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const deptId = randomUUID();
const desigId = randomUUID();
const otherDeptId = randomUUID();
const otherDesigId = randomUUID();

const LOC_HQ = randomUUID();
const LOC_CHILD = randomUUID();
const LOC_GRANDCHILD = randomUUID();
const LOC_OTHER = randomUUID();

const auth = (roles = ["hr_admin"], tid = TENANT) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: "s" }, SECRET)}`,
});

let app: FastifyInstance;
const realFetch = globalThis.fetch;

async function seed(tenantId: string, d: string, ds: string, fullName: string, employeeNo: string, over: Partial<typeof hrmsEmployees.$inferInsert> = {}) {
  const id = randomUUID();
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.insert(hrmsEmployees).values({
      id, tenantId, employeeNo, fullName, departmentId: d, designationId: ds,
      dateOfJoining: "2015-01-01", status: "confirmed", employeeType: "permanent",
      createdBy: ACTOR, updatedBy: ACTOR, ...over,
    });
  }));
  return id;
}

function stubLocationService(impl: (url: string) => Response | Promise<Response>) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes("/v1/locations/")) return impl(url);
    return realFetch(input, init);
  });
}

const get = (locationId: string, qs = "", headers = auth()) =>
  app.inject({ method: "GET", url: `/v1/hrms/locations/${locationId}/employees${qs}`, headers });

beforeAll(async () => {
  app = await buildApp();
  for (const [t, d, ds] of [[TENANT, deptId, desigId], [OTHER_TENANT, otherDeptId, otherDesigId]] as const) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.insert(hrmsDepartments).values({ id: d, tenantId: t, code: "D1", name: "Revenue", createdBy: ACTOR, updatedBy: ACTOR });
      await tx.insert(hrmsDesignations).values({ id: ds, tenantId: t, code: "DS1", name: "Clerk", createdBy: ACTOR, updatedBy: ACTOR });
    }));
  }
  // HQ: Charlie, Alice, Bob(+ a second "Bob" with a larger id for tie-break), exited Zed, on_leave Dina
  await seed(TENANT, deptId, desigId, "Charlie", "E-003", { locationId: LOC_HQ });
  await seed(TENANT, deptId, desigId, "Alice", "E-001", { locationId: LOC_HQ, mobile: "9876543210", pan: "ABCDE1234F", bankAccountNo: "123456789012" });
  await seed(TENANT, deptId, desigId, "Bob", "E-002", { locationId: LOC_HQ });
  await seed(TENANT, deptId, desigId, "Bob", "E-002B", { locationId: LOC_HQ });
  await seed(TENANT, deptId, desigId, "Zed", "E-099", { locationId: LOC_HQ, status: "separated" });
  await seed(TENANT, deptId, desigId, "Dina", "E-004", { locationId: LOC_HQ, status: "on_leave" });
  await seed(TENANT, deptId, desigId, "Child Person", "E-010", { locationId: LOC_CHILD });
  await seed(TENANT, deptId, desigId, "Grand Person", "E-011", { locationId: LOC_GRANDCHILD });
  await seed(TENANT, deptId, desigId, "Elsewhere", "E-020", { locationId: LOC_OTHER });
  // free-text location only (no locationId) -- never listed, but counted
  await seed(TENANT, deptId, desigId, "Free Text One", "E-030", { station: "Block office, Sector 5" });
  await seed(TENANT, deptId, desigId, "Free Text Two", "E-031", { station: "Tehsil" });
  await seed(TENANT, deptId, desigId, "Blank Station", "E-032", { station: "   " });
  // another tenant, SAME location id
  await seed(OTHER_TENANT, otherDeptId, otherDesigId, "Other Tenant Person", "X-001", { locationId: LOC_HQ });
});

// Every request resolves the location through location-service (existence check),
// so default to "exists, no descendants"; individual tests re-stub as needed.
beforeEach(() => {
  stubLocationService(() => new Response(JSON.stringify({ descendantIds: [] }), { status: 200 }));
});
afterEach(() => { vi.restoreAllMocks(); });

afterAll(async () => {
  for (const [t, d, ds] of [[TENANT, deptId, desigId], [OTHER_TENANT, otherDeptId, otherDesigId]] as const) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, t));
      await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.id, ds));
      await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.id, d));
    }));
  }
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/locations/:locationId/employees", () => {
  it("lists only this tenant's active employees at the location, ordered by name then id, with a total", async () => {
    const r = await get(LOC_HQ);
    expect(r.statusCode).toBe(200);
    const b = r.json();
    // Zed (separated) excluded by default; the other tenant's row at the same location id never appears.
    expect(b.total).toBe(5);
    expect(b.data.map((e: { name: string }) => e.name)).toEqual(["Alice", "Bob", "Bob", "Charlie", "Dina"]);
    const bobs = b.data.filter((e: { name: string }) => e.name === "Bob").map((e: { id: string }) => e.id);
    expect(bobs).toEqual([...bobs].sort());
    expect(b.data[0]).toMatchObject({ employeeNo: "E-001", designation: "Clerk", department: "Revenue", status: "confirmed" });
    expect(JSON.stringify(b)).not.toContain("Other Tenant Person");
  });

  it("is tenant-scoped: the other tenant sees only its own employee at the same location id", async () => {
    const r = await get(LOC_HQ, "", auth(["hr_admin"], OTHER_TENANT));
    expect(r.json().data.map((e: { name: string }) => e.name)).toEqual(["Other Tenant Person"]);
  });

  it("pages with bounded limit/offset and a stable total; pages never overlap", async () => {
    const p1 = (await get(LOC_HQ, "?limit=2&offset=0")).json();
    const p2 = (await get(LOC_HQ, "?limit=2&offset=2")).json();
    const p3 = (await get(LOC_HQ, "?limit=2&offset=4")).json();
    expect([p1.total, p2.total, p3.total]).toEqual([5, 5, 5]);
    const ids = [...p1.data, ...p2.data, ...p3.data].map((e: { id: string }) => e.id);
    expect(new Set(ids).size).toBe(5);
    expect(p1.data.map((e: { name: string }) => e.name)).toEqual(["Alice", "Bob"]);
    expect(p3.data.map((e: { name: string }) => e.name)).toEqual(["Dina"]);
  });

  it("rejects a limit above 100", async () => {
    expect((await get(LOC_HQ, "?limit=101")).statusCode).toBe(400);
    expect((await get(LOC_HQ, "?limit=100")).statusCode).toBe(200);
  });

  it("status filter: default excludes exited; status=separated and status=all work", async () => {
    expect((await get(LOC_HQ, "?status=separated")).json().data.map((e: { name: string }) => e.name)).toEqual(["Zed"]);
    expect((await get(LOC_HQ, "?status=all")).json().total).toBe(6);
    expect((await get(LOC_HQ, "?status=on_leave")).json().data.map((e: { name: string }) => e.name)).toEqual(["Dina"]);
  });

  it("searches by name or employee number (wildcards are literal)", async () => {
    expect((await get(LOC_HQ, "?q=ali")).json().data.map((e: { name: string }) => e.name)).toEqual(["Alice"]);
    expect((await get(LOC_HQ, "?q=E-002")).json().total).toBe(2);
    expect((await get(LOC_HQ, "?q=%25")).json().total).toBe(0);
  });

  it("includeSubLocations walks the descendant ids returned by location-service", async () => {
    let called = "";
    stubLocationService((url) => {
      called = url;
      return new Response(JSON.stringify({ descendantIds: [LOC_CHILD, LOC_GRANDCHILD] }), { status: 200 });
    });
    const r = await get(LOC_HQ, "?includeSubLocations=true&status=all");
    expect(called).toContain(`/v1/locations/${LOC_HQ}/hierarchy`);
    expect(r.json().data.map((e: { name: string }) => e.name)).toEqual(
      ["Alice", "Bob", "Bob", "Charlie", "Child Person", "Dina", "Grand Person", "Zed"],
    );
    // Same descendants returned, but without the option they are NOT included, and
    // the headers identify the caller.
    let headers: Record<string, string> = {};
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).includes("/v1/locations/")) {
        headers = init?.headers as Record<string, string>;
        return new Response(JSON.stringify({ descendantIds: [LOC_CHILD, LOC_GRANDCHILD] }), { status: 200 });
      }
      return realFetch(input, init);
    });
    const plain = await get(LOC_HQ);
    expect(plain.json().data.map((e: { name: string }) => e.name)).not.toContain("Child Person");
    expect(headers["x-internal-caller"]).toBe("hrms-service");
    expect(headers["x-tenant-id"]).toBe(TENANT);
  });

  it("fails closed (502) when location-service cannot resolve sub-locations, and 404s an unknown location", async () => {
    stubLocationService(() => new Response("boom", { status: 500 }));
    expect((await get(LOC_HQ, "?includeSubLocations=true")).statusCode).toBe(502);
    vi.restoreAllMocks();
    stubLocationService(() => new Response("{}", { status: 404 }));
    expect((await get(randomUUID(), "?includeSubLocations=true")).statusCode).toBe(404);
  });

  it("404s an unknown or other-tenant location even WITHOUT includeSubLocations (never a 200 with an empty roster)", async () => {
    stubLocationService(() => new Response("{}", { status: 404 }));
    const r = await get(randomUUID());
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    vi.restoreAllMocks();
    stubLocationService(() => new Response("boom", { status: 503 }));
    expect((await get(LOC_HQ)).statusCode).toBe(502);
  });

  it("reports how many employees have a free-text location but no locationId", async () => {
    const b = (await get(LOC_HQ)).json();
    expect(b.unlinkedCount).toBe(2); // blank/whitespace station is not "a location typed as text"
    expect(b.data.map((e: { name: string }) => e.name)).not.toContain("Free Text One");
  });

  it("is HR-only: hr_admin/hr_officer/super_admin allowed; manager, employee, payroll denied", async () => {
    for (const roles of [["hr_admin"], ["hr_officer"], ["super_admin"]]) {
      expect((await get(LOC_HQ, "", auth(roles))).statusCode).toBe(200);
    }
    for (const roles of [["manager"], ["employee"], ["payroll_admin"]]) {
      expect((await get(LOC_HQ, "", auth(roles))).statusCode).toBe(403);
    }
    expect((await app.inject({ method: "GET", url: `/v1/hrms/locations/${LOC_HQ}/employees` })).statusCode).toBe(401);
  });

  it("never returns PII (mobile / PAN / bank) for any row", async () => {
    const raw = (await get(LOC_HQ)).body;
    for (const needle of ["9876543210", "ABCDE1234F", "123456789012", '"mobile"', '"pan"', '"bankAccountNo"', '"aadhaarRef"', '"email"']) {
      expect(raw).not.toContain(needle);
    }
  });
});
