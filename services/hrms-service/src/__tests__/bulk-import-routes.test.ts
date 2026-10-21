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

// GAP-HR-EMPLOYEES-IMPORT-02: the route now records the batch (bulk-import/repo.ts) and an audit event
// inside db.transaction before queueing. This suite mocks the DB, so those two collaborators are mocked
// too; their real behaviour is covered against Postgres in tests/bulk-import-batches-real-db.test.ts.
vi.mock("../modules/bulk-import/repo.js", () => ({
  insertBatch: vi.fn(async () => {}),
  markRowFailed: vi.fn(async () => {}),
  markRowCreated: vi.fn(async () => {}),
  getBatchStatus: vi.fn(async () => null),
}));
vi.mock("../modules/recruitment/audit-emit.js", () => ({ emitAudit: vi.fn(async () => {}) }));

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
import * as importRepo from "../modules/bulk-import/repo.js";
import { emitAudit } from "../modules/recruitment/audit-emit.js";

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

describe("POST /v1/hrms/employees/bulk — existing employee numbers (GAP-HR-EMPLOYEES-IMPORT-02)", () => {
  it("400 — an employeeNo that already exists in the tenant is rejected with a row-level message BEFORE anything is recorded or queued", async () => {
    // 3rd scopedRead = the one-query existing-employeeNo lookup (after the two engagement-type reads).
    H.queryResults = [CANONICAL_TYPES, NO_TENANT_TYPES, [{ employeeNo: "E9002" }]];
    const publishSpy = vi.spyOn(queue, "publish");
    const app: FastifyInstance = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/hrms/employees/bulk",
      headers: { authorization: `Bearer ${adminTok}` },
      payload: { employees: [validEmployee(), validEmployee({ employeeNo: "E9002", fullName: "Already Here" })] },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
    const body = res.json<{ fieldErrors: { field: string; message: string }[] }>();
    expect(body.fieldErrors).toEqual([
      expect.objectContaining({ field: "employees.1.employeeNo", message: expect.stringContaining("Already exists in this tenant") }),
    ]);
    expect(publishSpy).not.toHaveBeenCalled();
    expect(importRepo.insertBatch).not.toHaveBeenCalled();
  });
});

describe("POST /v1/hrms/employees/bulk — batch record (GAP-HR-EMPLOYEES-IMPORT-02)", () => {
  beforeEach(() => {
    vi.mocked(importRepo.insertBatch).mockClear();
    vi.mocked(importRepo.markRowFailed).mockClear();
    vi.mocked(emitAudit).mockClear();
  });

  it("202 — records the batch (id = the 202's id, one pending row per employee keyed by the create messageId) BEFORE queueing, and tags each create with importBatchId", async () => {
    const order: string[] = [];
    vi.mocked(importRepo.insertBatch).mockImplementationOnce(async () => { order.push("insertBatch"); });
    const publishSpy = vi.spyOn(queue, "publish").mockImplementation(async () => { order.push("publish"); return "message-id"; });
    const app: FastifyInstance = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/hrms/employees/bulk",
      headers: { authorization: `Bearer ${adminTok}` },
      payload: { employees: [validEmployee(), validEmployee({ employeeNo: "E9003", fullName: "Second" })] },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    const batchId = res.json<{ id: string }>().id;
    expect(order).toEqual(["insertBatch", "publish", "publish"]);

    expect(importRepo.insertBatch).toHaveBeenCalledTimes(1);
    const batch = vi.mocked(importRepo.insertBatch).mock.calls[0]![1];
    expect(batch).toMatchObject({ id: batchId, tenantId: TENANT, requestedBy: "bulk-import-test-user" });
    expect(batch.rows.map((r) => [r.rowNo, r.employeeNo])).toEqual([[1, "E9001"], [2, "E9003"]]);

    const published = publishSpy.mock.calls.map((c) => c[1] as unknown as { messageId: string; payload: { id: string; importBatchId: string } });
    expect(published.map((m) => m.messageId)).toEqual(batch.rows.map((r) => r.messageId));
    expect(published.every((m) => m.payload.id === m.messageId && m.payload.importBatchId === batchId)).toBe(true);

    expect(emitAudit).toHaveBeenCalledWith(
      expect.anything(), expect.objectContaining({ tenantId: TENANT }), "hrms.employee.bulk_import_requested", "employee_import_batch", batchId, { total: 2 },
    );
  });

  it("a queue failure part-way marks the rows that were never queued as failed (NOT_QUEUED) and surfaces a 500 instead of leaving the batch 'processing' forever", async () => {
    let n = 0;
    vi.spyOn(queue, "publish").mockImplementation(async () => {
      n++;
      if (n === 2) throw new Error("broker down");
      return "message-id";
    });
    const app: FastifyInstance = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/hrms/employees/bulk",
      headers: { authorization: `Bearer ${adminTok}` },
      payload: { employees: [validEmployee(), validEmployee({ employeeNo: "E9004", fullName: "Two" }), validEmployee({ employeeNo: "E9005", fullName: "Three" })] },
    });
    await app.close();

    expect(res.statusCode).toBe(500);
    const rows = vi.mocked(importRepo.insertBatch).mock.calls[0]![1].rows;
    // row 1 was queued; rows 2 (the publish that threw) and 3 never were.
    const failedIds = vi.mocked(importRepo.markRowFailed).mock.calls.map((c) => [c[2], c[3]]);
    expect(failedIds).toEqual([[rows[1]!.messageId, "NOT_QUEUED"], [rows[2]!.messageId, "NOT_QUEUED"]]);
  });
});

describe("GET /v1/hrms/employees/bulk/status/:batchId (GAP-HR-EMPLOYEES-IMPORT-02)", () => {
  const BATCH = "bbbbbbbb-0001-4000-8000-000000000001";
  const get = async (url: string, token = adminTok) => {
    const app: FastifyInstance = await buildApp();
    const res = await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
    await app.close();
    return res;
  };

  it("404 NOT_FOUND for an id that is not a batch of this tenant -- not a made-up 'completed'", async () => {
    vi.mocked(importRepo.getBatchStatus).mockResolvedValueOnce(null);
    const res = await get(`/v1/hrms/employees/bulk/status/${BATCH}`);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "NOT_FOUND" });
    expect(importRepo.getBatchStatus).toHaveBeenCalledWith(TENANT, BATCH);
  });

  it("400 for an id that is not a uuid", async () => {
    const res = await get("/v1/hrms/employees/bulk/status/not-a-uuid");
    expect(res.statusCode).toBe(400);
  });

  it("200 — returns the real counts and the named failed rows", async () => {
    const status = {
      batchId: BATCH, status: "processing" as const, total: 3, created: 1, failed: 1, pending: 1,
      failedRows: [{ rowNo: 2, employeeNo: "E9003", code: "EMPLOYEE_NO_EXISTS" }],
    };
    vi.mocked(importRepo.getBatchStatus).mockResolvedValueOnce(status);
    const res = await get(`/v1/hrms/employees/bulk/status/${BATCH}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(status);
  });

  it.each(["employee", "hr_officer", "manager"])("403 for %s (same role gate as the POST)", async (role) => {
    const res = await get(`/v1/hrms/employees/bulk/status/${BATCH}`, tok([role]));
    expect(res.statusCode).toBe(403);
  });
});
