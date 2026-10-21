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
 * __tests__/department-routes.test.ts). The route only publishes commands
 * (hrms.employee.bulk_import.record -- the consumer records the batch and fans
 * the hrms.employee.create commands out; see tests/bulk-import-batches-real-db.test.ts
 * for that half against Postgres), so queue.publish is spied on directly and the
 * create payloads are read out of the record commands.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

// GAP-HR-EMPLOYEES-IMPORT-02: the batch record lives in bulk-import/repo.ts. The route must never write it (CQRS:
// only the record consumer does), so the writers are mocked purely to assert they are NOT called from the route;
// the status read is stubbed, and their real behaviour is covered against Postgres in
// tests/bulk-import-batches-real-db.test.ts.
vi.mock("../modules/bulk-import/repo.js", () => ({
  insertBatch: vi.fn(async () => true),
  markRowFailed: vi.fn(async () => {}),
  markRowCreated: vi.fn(async () => {}),
  getBatchStatus: vi.fn(async () => null),
}));

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
import { COMMANDS } from "../topics.js";
import type { BulkImportNotQueuedPayload, BulkImportRecordPayload } from "../modules/bulk-import/command.js";

afterAll(async () => { await sqlClient.end(); });

type Published = { messageId: string; payload: unknown };
type PublishSpy = { mock: { calls: unknown[][] } };
const published = (spy: PublishSpy, topic: string): Published[] =>
  spy.mock.calls.filter((c) => c[0] === topic).map((c) => c[1] as Published);
/** The record commands the route published, in order. */
const recordCommands = (spy: PublishSpy): Array<Published & { payload: BulkImportRecordPayload }> =>
  published(spy, COMMANDS.employeeBulkImportRecord) as Array<Published & { payload: BulkImportRecordPayload }>;
/** The hrms.employee.create payloads carried by the record commands (what the consumer will publish). */
const createPayloads = (spy: PublishSpy): Array<Record<string, unknown>> =>
  recordCommands(spy).flatMap((m) => m.payload.items.map((i) => i.create));

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
  it("202 — accepts a valid batch and forwards each row's employeeType onto the create payload it queues", async () => {
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
    // The regression this guards: employeeType used to be absent from
    // bulkImportBody, so Zod stripped it and this would be undefined.
    expect(createPayloads(publishSpy)[0]!.employeeType).toBe("consultant");
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

  // GAP-HR-EMPLOYEES-IMPORT-05: managerEmployeeNo is resolved server-side, within
  // the caller's tenant, to a real managerId before anything is queued. The
  // scopedRead mock answers in call order: canonical types, tenant types,
  // existing employeeNos, then the manager rows.
  describe("managerEmployeeNo (GAP-HR-EMPLOYEES-IMPORT-05)", () => {
    const MANAGER_ID = "33333333-3333-4333-8333-333333333333";

    async function post(employees: Record<string, unknown>[]) {
      const app: FastifyInstance = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/hrms/employees/bulk",
        headers: { authorization: `Bearer ${adminTok}` },
        payload: { employees },
      });
      await app.close();
      return res;
    }

    it("202 — an existing manager's employeeNo is resolved to managerId on the queued create message", async () => {
      H.queryResults = [CANONICAL_TYPES, NO_TENANT_TYPES, [], [{ id: MANAGER_ID, employeeNo: "M-1" }]];
      const publishSpy = vi.spyOn(queue, "publish");
      const res = await post([validEmployee({ managerEmployeeNo: "M-1" })]);

      expect(res.statusCode).toBe(202);
      expect(publishSpy).toHaveBeenCalledTimes(1);
      const create = createPayloads(publishSpy)[0]!;
      expect(create.managerId).toBe(MANAGER_ID);
      // The human-readable number is an input only; it is not forwarded as a column value.
      expect(create).not.toHaveProperty("managerEmployeeNo");
    });

    it("202 — a row with no manager queues no managerId at all", async () => {
      const publishSpy = vi.spyOn(queue, "publish");
      const res = await post([validEmployee()]);

      expect(res.statusCode).toBe(202);
      expect(createPayloads(publishSpy)[0]).not.toHaveProperty("managerId");
    });

    it("400 — an unknown manager number is a row-level error on that row's managerEmployeeNo, and nothing is queued", async () => {
      H.queryResults = [CANONICAL_TYPES, NO_TENANT_TYPES, [], []];
      const publishSpy = vi.spyOn(queue, "publish");
      const res = await post([validEmployee({ employeeNo: "E9100" }), validEmployee({ employeeNo: "E9101", managerEmployeeNo: "NOPE-1" })]);

      expect(res.statusCode).toBe(400);
      const body = res.json<{ fieldErrors: { field: string; message: string }[] }>();
      expect(body.fieldErrors).toEqual([
        expect.objectContaining({ field: "employees.1.managerEmployeeNo", message: expect.stringContaining("Unknown manager employee number: NOPE-1") }),
      ]);
      expect(publishSpy).not.toHaveBeenCalled();
    });

    it("400 — an employee cannot be their own manager", async () => {
      H.queryResults = [CANONICAL_TYPES, NO_TENANT_TYPES, [], [{ id: MANAGER_ID, employeeNo: "E9200" }]];
      const publishSpy = vi.spyOn(queue, "publish");
      const res = await post([validEmployee({ employeeNo: "E9200", managerEmployeeNo: "E9200" })]);

      expect(res.statusCode).toBe(400);
      expect(res.json<{ fieldErrors: { field: string; message: string }[] }>().fieldErrors).toEqual([
        expect.objectContaining({ field: "employees.0.managerEmployeeNo", message: expect.stringContaining("own manager") }),
      ]);
      expect(publishSpy).not.toHaveBeenCalled();
    });

    it("400 — a manager who is only another row of the same file cannot be resolved yet (no ordering guarantee between queued rows)", async () => {
      H.queryResults = [CANONICAL_TYPES, NO_TENANT_TYPES, [], []];
      const publishSpy = vi.spyOn(queue, "publish");
      const res = await post([
        validEmployee({ employeeNo: "E9300" }),
        validEmployee({ employeeNo: "E9301", managerEmployeeNo: "E9300" }),
      ]);

      expect(res.statusCode).toBe(400);
      expect(res.json<{ fieldErrors: { field: string; message: string }[] }>().fieldErrors).toEqual([
        expect.objectContaining({ field: "employees.1.managerEmployeeNo", message: expect.stringContaining("same file") }),
      ]);
      expect(publishSpy).not.toHaveBeenCalled();
    });
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
  });

  const manyEmployees = (n: number) => Array.from({ length: n }, (_, i) => validEmployee({ employeeNo: `E${20000 + i}`, fullName: `Row ${i + 1}` }));
  const bulk = async (employees: unknown[]) => {
    const app: FastifyInstance = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/hrms/employees/bulk", headers: { authorization: `Bearer ${adminTok}` }, payload: { employees } });
    await app.close();
    return res;
  };

  it("202 — publishes the batch for recording (id = the 202's id, one row per employee keyed by the create messageId), tags each create with importBatchId, and writes nothing itself", async () => {
    const publishSpy = vi.spyOn(queue, "publish").mockImplementation(async () => "message-id");
    const res = await bulk([validEmployee(), validEmployee({ employeeNo: "E9003", fullName: "Second" })]);

    expect(res.statusCode).toBe(202);
    const batchId = res.json<{ id: string }>().id;

    // Only the record command goes out from the route: the create commands are the consumer's, published
    // after it has committed the batch (so each create always has a row to mark).
    expect(publishSpy.mock.calls.map((c) => c[0])).toEqual([COMMANDS.employeeBulkImportRecord]);
    const [record] = recordCommands(publishSpy);
    expect(record!.payload).toMatchObject({ batchId, total: 2 });
    expect(record!.payload.items.map((i) => [i.rowNo, i.employeeNo])).toEqual([[1, "E9001"], [2, "E9003"]]);
    // The row id doubles as the create command's messageId and as the new employee's id.
    expect(record!.payload.items.every((i) => i.create.id === i.id && i.create.importBatchId === batchId && i.create.tenantId === TENANT)).toBe(true);
    expect(new Set(record!.payload.items.map((i) => i.id)).size).toBe(2);

    // CQRS: the route itself records nothing (that is the consumer's job, in one transaction with markProcessed).
    expect(importRepo.insertBatch).not.toHaveBeenCalled();
    expect(importRepo.markRowFailed).not.toHaveBeenCalled();
  });

  it("202 — a batch over the chunk size is split across record commands that all carry the whole batch's id and total, with contiguous row numbers", async () => {
    const publishSpy = vi.spyOn(queue, "publish").mockImplementation(async () => "message-id");
    const res = await bulk(manyEmployees(250));

    expect(res.statusCode).toBe(202);
    const batchId = res.json<{ id: string }>().id;
    const commands = recordCommands(publishSpy);
    expect(commands.map((c) => c.payload.items.length)).toEqual([100, 100, 50]);
    expect(commands.every((c) => c.payload.batchId === batchId && c.payload.total === 250)).toBe(true);
    expect(commands.flatMap((c) => c.payload.items.map((i) => i.rowNo))).toEqual(Array.from({ length: 250 }, (_, i) => i + 1));
    expect(new Set(commands.map((c) => c.messageId)).size).toBe(3); // distinct commands, never one id reused
    expect(published(publishSpy, COMMANDS.employeeBulkImportNotQueued)).toEqual([]);
  });

  it("a queue failure part-way answers 500 and publishes a not_queued command naming every row that was never queued (the chunk whose publish threw included), so the batch cannot read 'processing' forever", async () => {
    let n = 0;
    const publishSpy = vi.spyOn(queue, "publish").mockImplementation(async () => {
      n++;
      if (n === 2) throw new Error("broker down");
      return "message-id";
    });
    const res = await bulk(manyEmployees(250));

    expect(res.statusCode).toBe(500);
    // chunk 1 went out; the publish of chunk 2 threw; chunk 3 was never attempted.
    expect(recordCommands(publishSpy)).toHaveLength(2);
    const [notQueued] = published(publishSpy, COMMANDS.employeeBulkImportNotQueued) as Array<Published & { payload: BulkImportNotQueuedPayload }>;
    expect(notQueued).toBeDefined();
    const batchId = recordCommands(publishSpy)[0]!.payload.batchId;
    expect(notQueued!.payload).toMatchObject({ batchId, total: 250 });
    expect(notQueued!.payload.items.map((i) => i.rowNo)).toEqual(Array.from({ length: 150 }, (_, i) => i + 101));
    expect(notQueued!.payload.items.every((i) => typeof i.id === "string" && typeof i.employeeNo === "string")).toBe(true);
    expect(notQueued!.payload.items[0]).not.toHaveProperty("create"); // ids and numbers only -- no employee data
  });

  it("if even the not_queued command cannot be published, the original queue error is still what surfaces (500), not a second failure", async () => {
    vi.spyOn(queue, "publish").mockImplementation(async () => { throw new Error("broker down"); });
    const res = await bulk([validEmployee()]);
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ code: "INTERNAL" });
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
