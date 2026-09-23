/**
 * Bulk employee import route — HRMS role-based review, finding 2.
 *
 * POST /v1/hrms/employees/bulk went entirely unused by ImportForm.tsx before
 * this fix. Wiring the form to it surfaced three real bugs in the route
 * itself, which this file covers directly (not just "the form now calls the
 * endpoint"):
 *
 *  - employeeType was missing from bulkImportBody entirely, so it was
 *    silently stripped by Zod before ever reaching queue.publish -- every
 *    bulk-imported employee lost its engagement type. Now declared (default
 *    "permanent", matching createEmployeeBody) and asserted to actually
 *    reach the queued hrms.employee.create message.
 *  - Nothing validated employeeType against the known-engagement-type sets
 *    the single-row path enforces via assertKnownEngagementType -- an
 *    unknown/typo'd type would reach the DB unvalidated (the consumer's
 *    `p.employeeType as "permanent"` is a compile-time-only cast). Now
 *    checked per-row via isKnownEngagementType, before anything is queued.
 *  - Validation failures used a bespoke `errors: [{row, field, message}]`
 *    envelope no frontend consumer could parse -- apps/web's shared
 *    useFormError hook only reads `fieldErrors` (keyed by field). Now both
 *    the duplicate-employeeNo check and the employeeType check report
 *    through `fieldErrors`, matching the shape the ZodError handler already
 *    used for schema failures.
 *
 * Pattern: buildApp() + app.inject(), DB mocked via vi.mock (same shape as
 * __tests__/department-routes.test.ts). This route's writes are a plain
 * queue.publish (not the F3/publishF3Write CQRS pattern department-routes
 * drains via a registered consumer), so queue.publish is spied on directly
 * instead.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000011";

function tok(roles: string[], sub = "bulk-import-test-user") {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-bulk-import-test" }, SECRET);
}
const adminTok = tok(["hr_admin"]);

// ── DB mock ───────────────────────────────────────────────────────────────
// resolveKnownEngagementTypeSets() (engagement-policy.ts) makes exactly two
// scopedRead calls per bulk-import request, in order: the global canonical
// catalogue (no .where()), then this tenant's hrms_employee_types master
// (.where()'d). H.queryResults supplies each call's row set in that order;
// H.callCount tracks which call we're on. Reset both in beforeEach so tests
// don't leak state into each other.
const H = vi.hoisted(() => ({
  queryResults: [] as unknown[][],
  callCount: { n: 0 },
}));

vi.mock("../shared/db.js", () => {
  // app.ts's buildApp() unconditionally does
  // `app.addHook("onRequest", createTenantTxHook(db))` and imports
  // `sqlClient` alongside -- both named imports must exist on this mock (even
  // though neither is exercised by these tests: createTenantTxHook only
  // dereferences `db` inside a per-request closure that never runs here,
  // since these requests carry no x-tenant-id header, matching
  // department-routes.test.ts's tokens) or Vitest's ESM mock throws before
  // any test body runs. Same stub shape department-routes.test.ts uses.
  const sqlClientFn = (..._args: unknown[]) => Promise.resolve([]);
  sqlClientFn.end = vi.fn(async () => {});
  sqlClientFn.unsafe = vi.fn((..._args: unknown[]) => Promise.resolve([]));
  sqlClientFn.begin = vi.fn(async (fn: (tx: typeof sqlClientFn) => Promise<unknown>) => fn(sqlClientFn));

  return {
    db: { transaction: async (cb: (tx: unknown) => unknown) => cb({}) },
    sqlClient: sqlClientFn,
    scopedRead: (fn: (tx: unknown) => unknown) => {
      const rows = H.queryResults[H.callCount.n] ?? [];
      H.callCount.n++;
      const thenableRows = { then: (res: (v: unknown) => unknown) => Promise.resolve(res(rows)) };
      const tx = { select: () => ({ from: () => ({ ...thenableRows, where: () => thenableRows }) }) };
      return Promise.resolve(fn(tx));
    },
  };
});

import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";

afterAll(async () => { await sqlClient.end(); });

const CANONICAL_TYPES = [{ c: "permanent" }, { c: "consultant" }];
const NO_TENANT_TYPES: unknown[] = [];

function validEmployee(overrides: Record<string, unknown> = {}) {
  return {
    employeeNo: "E9001",
    fullName: "Test Employee",
    departmentId: "11111111-1111-4111-8111-111111111111",
    designationId: "22222222-2222-4222-8222-222222222222",
    dateOfJoining: "2026-01-01",
    employeeType: "consultant",
    ...overrides,
  };
}

beforeEach(() => {
  H.queryResults = [CANONICAL_TYPES, NO_TENANT_TYPES];
  H.callCount.n = 0;
  vi.restoreAllMocks();
});

describe("POST /v1/hrms/employees/bulk", () => {
  it("202 — accepts a valid batch and forwards each row's employeeType onto the queued create message", async () => {
    const publishSpy = vi.spyOn(queue, "publish");
    const app: FastifyInstance = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/hrms/employees/bulk",
      headers: { authorization: `Bearer ${adminTok}` },
      payload: { employees: [validEmployee()] },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    expect(publishSpy).toHaveBeenCalledTimes(1);
    const [, message] = publishSpy.mock.calls[0] as unknown as [string, { payload: Record<string, unknown> }];
    // The regression this guards: employeeType used to be absent from
    // bulkImportBody, so Zod stripped it and this would be undefined.
    expect(message.payload.employeeType).toBe("consultant");
  });

  it("400 — unknown employeeType is rejected via fieldErrors, and nothing is queued", async () => {
    const publishSpy = vi.spyOn(queue, "publish");
    const app: FastifyInstance = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/hrms/employees/bulk",
      headers: { authorization: `Bearer ${adminTok}` },
      payload: { employees: [validEmployee({ employeeType: "not_a_real_type" })] },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
    const body = res.json<{ fieldErrors?: { field: string; message: string }[]; errors?: unknown }>();
    expect(body.errors).toBeUndefined(); // old, frontend-unparseable shape must be gone
    expect(body.fieldErrors).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: "employees.0.employeeType" })]),
    );
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("400 — in-batch duplicate employeeNo is rejected via fieldErrors (not the old `errors` shape), and nothing is queued", async () => {
    const publishSpy = vi.spyOn(queue, "publish");
    const app: FastifyInstance = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/hrms/employees/bulk",
      headers: { authorization: `Bearer ${adminTok}` },
      payload: { employees: [validEmployee(), validEmployee({ fullName: "Second Row" })] },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
    const body = res.json<{ fieldErrors?: { field: string; message: string }[] }>();
    expect(body.fieldErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "employees.1.employeeNo", message: expect.stringContaining("Duplicate") }),
      ]),
    );
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it("202 — a tenant-custom employee type (not in the global canonical catalogue) is still accepted", async () => {
    H.queryResults = [CANONICAL_TYPES, [{ c: "naps_apprentice" }]];
    const publishSpy = vi.spyOn(queue, "publish");
    const app: FastifyInstance = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/hrms/employees/bulk",
      headers: { authorization: `Bearer ${adminTok}` },
      payload: { employees: [validEmployee({ employeeType: "naps_apprentice" })] },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    expect(publishSpy).toHaveBeenCalledTimes(1);
  });

  it("403 — a role outside HR_ROLES cannot bulk-import", async () => {
    const app: FastifyInstance = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/hrms/employees/bulk",
      headers: { authorization: `Bearer ${tok(["employee"])}` },
      payload: { employees: [validEmployee()] },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
