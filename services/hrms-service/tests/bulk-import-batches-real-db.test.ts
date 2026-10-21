/**
 * GAP-HR-EMPLOYEES-IMPORT-02 (real Postgres, migration 0250): POST
 * /v1/hrms/employees/bulk publishes the batch (the route never writes -- CQRS); the
 * hrms.employee.bulk_import.record consumer records the batch + one pending row per
 * employee in one transaction BEFORE it publishes the per-employee creates; the
 * hrms.employee.create consumer marks each row 'created' in the same transaction as
 * the employee insert, or 'failed' (stable code only) when the create is refused;
 * GET .../bulk/status/:batchId reports the real counts and names the failed rows, and
 * answers 404 for any id that is not a batch of the caller's tenant.
 *
 * Real async path (the consumers + drain), same convention as
 * tests/employee-status-guards-real-db.test.ts. Fresh random tenants per run; the
 * tables are FORCE RLS so direct reads/writes go through runWithTenant.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { buildApp } from "../src/app.js";
import { registerEmployeeConsumers } from "../src/modules/employee/consumer.js";
import { registerBulkImportConsumers } from "../src/modules/bulk-import/consumer.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";
import { hrmsBulkImportBatches, hrmsBulkImportRows } from "../src/modules/bulk-import/schema.js";
import * as importRepo from "../src/modules/bulk-import/repo.js";
import { COMMANDS } from "../src/topics.js";
import type { FastifyInstance } from "fastify";
import type { MemoryQueue } from "@civitasone/queue";

registerEmployeeConsumers(queue);
registerBulkImportConsumers(queue);
const drain = (): Promise<void> => (queue as unknown as MemoryQueue).drain();

const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
// vitest.config.ts injects JWT_SECRET for every suite -- never a literal here (gitleaks scans every commit).
const SECRET = process.env.JWT_SECRET as string;
const deptId = randomUUID();
const desigId = randomUUID();
const hdr = (tenant: string, roles = ["hr_admin"]) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles, sid: "s" }, SECRET)}`,
  "content-type": "application/json",
});

let app: FastifyInstance;
const suffix = randomUUID().slice(0, 6);
const no = (n: string) => `BI-${suffix}-${n}`;

const row = (n: string, over: Record<string, unknown> = {}) => ({
  employeeNo: no(n), fullName: `Bulk Import ${n}`, departmentId: deptId, designationId: desigId,
  dateOfJoining: "2026-01-01", employeeType: "permanent", basicMinor: 0, ...over,
});
const postBulk = (employees: unknown[], tenant = TENANT, roles = ["hr_admin"]) =>
  app.inject({ method: "POST", url: "/v1/hrms/employees/bulk", headers: hdr(tenant, roles), payload: { employees } });
const getStatus = (batchId: string, tenant = TENANT, roles = ["hr_admin"]) =>
  app.inject({ method: "GET", url: `/v1/hrms/employees/bulk/status/${batchId}`, headers: hdr(tenant, roles) });

const asTenant = <T>(tenant: string, fn: () => Promise<T>): Promise<T> => runWithTenant(tenant, fn) as Promise<T>;

async function seedParents(tenant: string, d: string, g: string): Promise<void> {
  await asTenant(tenant, () => db.transaction(async (tx) => {
    await tx.insert(hrmsDepartments).values({ id: d, tenantId: tenant, code: `BI-${suffix}`, name: "Bulk Import Dept", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(hrmsDesignations).values({ id: g, tenantId: tenant, code: `BI-${suffix}`, name: "Bulk Import Designation", createdBy: ACTOR, updatedBy: ACTOR });
  }));
}

async function employeeExists(employeeNo: string): Promise<boolean> {
  const rows = await asTenant(TENANT, () => db.transaction((tx) => tx.select({ id: hrmsEmployees.id }).from(hrmsEmployees)
    .where(and(eq(hrmsEmployees.tenantId, TENANT), eq(hrmsEmployees.employeeNo, employeeNo))).limit(1)));
  return rows.length === 1;
}

async function batchRows(batchId: string) {
  return asTenant(TENANT, () => db.transaction((tx) => tx.select().from(hrmsBulkImportRows)
    .where(and(eq(hrmsBulkImportRows.tenantId, TENANT), eq(hrmsBulkImportRows.batchId, batchId))).orderBy(hrmsBulkImportRows.rowNo)));
}

/** How many "bulk import requested" audit events were emitted for this batch (must be exactly one per batch). */
async function requestedAuditCount(batchId: string): Promise<number> {
  const r = await sqlClient`
    SELECT count(*)::int AS n FROM _outbox.messages
    WHERE topic = 'audit.event.record' AND tenant_id = ${TENANT}
      AND payload->>'action' = 'hrms.employee.bulk_import_requested' AND payload->>'resourceId' = ${batchId}`;
  return r[0]!.n as number;
}

type RecordItem = { id: string; rowNo: number; employeeNo: string; create: Record<string, unknown> };
const recordItem = (batchId: string, rowNo: number, employeeNo: string): RecordItem => {
  const id = randomUUID();
  return {
    id, rowNo, employeeNo,
    create: {
      id, tenantId: TENANT, employeeNo, fullName: `Scripted ${employeeNo}`, departmentId: deptId, designationId: desigId,
      dateOfJoining: "2026-01-01", employeeType: "permanent", basicMinor: 0, currency: "INR", importBatchId: batchId,
    },
  };
};
const publishRecord = (batchId: string, total: number, items: RecordItem[], messageId = randomUUID()) =>
  queue.publish(COMMANDS.employeeBulkImportRecord, {
    messageId, type: COMMANDS.employeeBulkImportRecord, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
    payload: { batchId, total, items },
  });
const publishNotQueued = (batchId: string, total: number, items: RecordItem[]) =>
  queue.publish(COMMANDS.employeeBulkImportNotQueued, {
    messageId: randomUUID(), type: COMMANDS.employeeBulkImportNotQueued, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
    payload: { batchId, total, items: items.map(({ id, rowNo, employeeNo }) => ({ id, rowNo, employeeNo })) },
  });

/** Insert a batch record by hand and publish its create commands, bypassing the route (to script the failures). */
async function runBatch(items: Array<{ employeeNo: string; payload?: Record<string, unknown> }>): Promise<string> {
  const batchId = randomUUID();
  const ids = items.map(() => randomUUID());
  await asTenant(TENANT, () => db.transaction((tx) => importRepo.insertBatch(tx, {
    id: batchId, tenantId: TENANT, requestedBy: ACTOR, correlationId: null,
    rows: items.map((it, i) => ({ messageId: ids[i]!, rowNo: i + 1, employeeNo: it.employeeNo })),
  })));
  for (const [i, it] of items.entries()) {
    await queue.publish(COMMANDS.employeeCreate, {
      messageId: ids[i]!, type: COMMANDS.employeeCreate, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: {
        id: ids[i]!, tenantId: TENANT, employeeNo: it.employeeNo, fullName: `Scripted ${it.employeeNo}`, departmentId: deptId, designationId: desigId,
        dateOfJoining: "2026-01-01", employeeType: "permanent", basicMinor: 0, currency: "INR", importBatchId: batchId, ...it.payload,
      },
    });
  }
  await drain();
  return batchId;
}

beforeAll(async () => {
  app = await buildApp();
  await seedParents(TENANT, deptId, desigId);
});

afterAll(async () => {
  for (const t of [TENANT, OTHER_TENANT]) {
    await asTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(hrmsBulkImportBatches).where(eq(hrmsBulkImportBatches.tenantId, t)); // rows cascade
      await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, t));
      await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, t));
      await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, t));
    }));
  }
  await app.close();
  await sqlClient.end();
});

describe("migration 0250 -- import batch tables", () => {
  it("both tables exist with FORCE row level security and a tenant policy", async () => {
    const rel = await sqlClient`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'employee' AND c.relname IN ('hrms_bulk_import_batches', 'hrms_bulk_import_rows') ORDER BY c.relname`;
    expect(rel.map((r) => [r.relname, r.relrowsecurity, r.relforcerowsecurity])).toEqual([
      ["hrms_bulk_import_batches", true, true],
      ["hrms_bulk_import_rows", true, true],
    ]);
    const pol = await sqlClient`SELECT tablename FROM pg_policies WHERE schemaname = 'employee' AND tablename IN ('hrms_bulk_import_batches', 'hrms_bulk_import_rows')`;
    expect(pol).toHaveLength(2);
  });
});

describe("POST /bulk + GET /bulk/status/:batchId -- end to end", () => {
  it("records the batch, creates every employee, and the status route reports completed with real counts", async () => {
    const res = await postBulk([row("a1"), row("a2"), row("a3")]);
    expect(res.statusCode).toBe(202);
    const batchId = res.json<{ id: string }>().id;

    // The route wrote nothing: the batch exists only once the record consumer has run.
    await drain();
    const s = await getStatus(batchId);
    expect(s.statusCode).toBe(200);
    expect(s.json()).toEqual({ batchId, status: "completed", total: 3, created: 3, failed: 0, pending: 0, failedRows: [] });
    for (const n of ["a1", "a2", "a3"]) expect(await employeeExists(no(n))).toBe(true);
    const rows = await batchRows(batchId);
    expect(rows.map((r) => [r.rowNo, r.employeeNo, r.status, r.errorCode])).toEqual([[1, no("a1"), "created", null], [2, no("a2"), "created", null], [3, no("a3"), "created", null]]);
    expect(await requestedAuditCount(batchId)).toBe(1);
  });

  it("a batch larger than one record command (120 rows -> 100 + 20) is recorded across chunks and still completes with the whole batch's total, audited once", async () => {
    const res = await postBulk(Array.from({ length: 120 }, (_, i) => row(`m${i}`)));
    expect(res.statusCode).toBe(202);
    const batchId = res.json<{ id: string }>().id;
    await drain();

    expect((await getStatus(batchId)).json()).toEqual({ batchId, status: "completed", total: 120, created: 120, failed: 0, pending: 0, failedRows: [] });
    const rows = await batchRows(batchId);
    expect(rows.map((r) => r.rowNo)).toEqual(Array.from({ length: 120 }, (_, i) => i + 1));
    expect(await requestedAuditCount(batchId)).toBe(1);
  });

  it("reports 'processing' with the pending count while rows have not been consumed yet", async () => {
    const batchId = randomUUID();
    await asTenant(TENANT, () => db.transaction((tx) => importRepo.insertBatch(tx, {
      id: batchId, tenantId: TENANT, requestedBy: ACTOR, correlationId: null,
      rows: [1, 2, 3].map((n) => ({ messageId: randomUUID(), rowNo: n, employeeNo: no(`p${n}`) })),
    })));
    const s = await getStatus(batchId);
    expect(s.json()).toMatchObject({ status: "processing", total: 3, created: 0, failed: 0, pending: 3, failedRows: [] });
  });

  it("an employee number that already exists is refused BEFORE the batch is recorded or anything is queued (400, no batch row)", async () => {
    const before = await asTenant(TENANT, () => db.transaction((tx) => tx.select({ id: hrmsBulkImportBatches.id }).from(hrmsBulkImportBatches).where(eq(hrmsBulkImportBatches.tenantId, TENANT))));
    const res = await postBulk([row("a1"), row("fresh")]); // a1 was created above
    expect(res.statusCode).toBe(400);
    expect(res.json<{ fieldErrors: { field: string; message: string }[] }>().fieldErrors).toEqual([
      expect.objectContaining({ field: "employees.0.employeeNo", message: expect.stringContaining("Already exists in this tenant") }),
    ]);
    await drain();
    expect(await employeeExists(no("fresh"))).toBe(false);
    const after = await asTenant(TENANT, () => db.transaction((tx) => tx.select({ id: hrmsBulkImportBatches.id }).from(hrmsBulkImportBatches).where(eq(hrmsBulkImportBatches.tenantId, TENANT))));
    expect(after.length).toBe(before.length);
  });
});

describe("consumer outcomes land on the import rows", () => {
  it("a create that loses a race on the employee number is 'failed' with EMPLOYEE_NO_EXISTS; the rest of the batch still completes", async () => {
    // b2's number is taken by someone else between validation and consumption.
    await asTenant(TENANT, () => db.transaction((tx) => tx.insert(hrmsEmployees).values({
      id: randomUUID(), tenantId: TENANT, employeeNo: no("b2"), fullName: "Already Here", departmentId: deptId, designationId: desigId,
      dateOfJoining: "2015-01-01", status: "confirmed", employeeType: "permanent", createdBy: ACTOR, updatedBy: ACTOR,
    })));
    const batchId = await runBatch([{ employeeNo: no("b1") }, { employeeNo: no("b2") }, { employeeNo: no("b3") }]);

    const s = (await getStatus(batchId)).json();
    expect(s).toEqual({
      batchId, status: "completed", total: 3, created: 2, failed: 1, pending: 0,
      failedRows: [{ rowNo: 2, employeeNo: no("b2"), code: "EMPLOYEE_NO_EXISTS" }],
    });
    expect(await employeeExists(no("b1"))).toBe(true);
    expect(await employeeExists(no("b3"))).toBe(true);
  });

  it("a create the database rejects as bad data (value too long) is 'failed' with INVALID_VALUE, without being retried", async () => {
    const batchId = await runBatch([{ employeeNo: no("c1"), payload: { employeeType: "x".repeat(40) } }, { employeeNo: no("c2") }]);
    const s = (await getStatus(batchId)).json<{ created: number; failedRows: { rowNo: number; code: string }[] }>();
    expect(s.created).toBe(1);
    expect(s.failedRows).toEqual([expect.objectContaining({ rowNo: 1, code: "INVALID_VALUE" })]);
    expect(await employeeExists(no("c1"))).toBe(false);
    expect(await employeeExists(no("c2"))).toBe(true);
  });

  it("never stores or returns the error text -- only a code (no names, numbers or SQL)", async () => {
    const batchId = await runBatch([{ employeeNo: no("d1"), payload: { mobile: "9876543210" } }, { employeeNo: no("a1") /* exists already */ }]);
    const res = await getStatus(batchId);
    expect(res.body).not.toMatch(/Scripted|9876543210|insert into|violates|duplicate key/i);
    const stored = await batchRows(batchId);
    expect(JSON.stringify(stored)).not.toMatch(/Scripted|9876543210|insert into|violates|duplicate key/i);
  });

  it("redelivery of the same command does not double-count", async () => {
    const batchId = randomUUID();
    const id = randomUUID();
    await asTenant(TENANT, () => db.transaction((tx) => importRepo.insertBatch(tx, {
      id: batchId, tenantId: TENANT, requestedBy: ACTOR, correlationId: null, rows: [{ messageId: id, rowNo: 1, employeeNo: no("e1") }],
    })));
    const publish = () => queue.publish(COMMANDS.employeeCreate, {
      messageId: id, type: COMMANDS.employeeCreate, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id, tenantId: TENANT, employeeNo: no("e1"), fullName: "Once Only", departmentId: deptId, designationId: desigId, dateOfJoining: "2026-01-01", employeeType: "permanent", basicMinor: 0, currency: "INR", importBatchId: batchId },
    });
    await publish(); await drain();
    await publish(); await drain();
    expect((await getStatus(batchId)).json()).toMatchObject({ status: "completed", total: 1, created: 1, failed: 0 });
  });

  it("a plain (non-import) create that is refused does not touch any import row or crash the outcome hook", async () => {
    const id = randomUUID();
    await queue.publish(COMMANDS.employeeCreate, {
      messageId: id, type: COMMANDS.employeeCreate, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id, tenantId: TENANT, employeeNo: no("a1"), fullName: "Dup Single", departmentId: deptId, designationId: desigId, dateOfJoining: "2026-01-01", employeeType: "permanent", basicMinor: 0, currency: "INR" },
    });
    await expect(drain()).resolves.toBeUndefined();
  });
});

describe("record / not_queued commands -- idempotence and ordering", () => {
  it("redelivery of the same record command neither records, audits nor fans out a second time", async () => {
    const batchId = randomUUID();
    const items = [recordItem(batchId, 1, no("r1")), recordItem(batchId, 2, no("r2"))];
    const messageId = randomUUID();
    await publishRecord(batchId, 2, items, messageId); await drain();
    await publishRecord(batchId, 2, items, messageId); await drain();

    expect((await getStatus(batchId)).json()).toEqual({ batchId, status: "completed", total: 2, created: 2, failed: 0, pending: 0, failedRows: [] });
    expect(await requestedAuditCount(batchId)).toBe(1);
  });

  it("chunks of one batch recorded in any order build one batch: a not-yet-recorded chunk reads as pending, not as missing", async () => {
    const batchId = randomUUID();
    const first = [recordItem(batchId, 1, no("o1"))];
    const second = [recordItem(batchId, 2, no("o2"))];
    await publishRecord(batchId, 2, second); await drain(); // chunk 2 lands first and creates the header
    expect((await getStatus(batchId)).json()).toMatchObject({ status: "processing", total: 2, created: 1, pending: 1 });
    await publishRecord(batchId, 2, first); await drain();
    expect((await getStatus(batchId)).json()).toMatchObject({ status: "completed", total: 2, created: 2, pending: 0 });
    expect(await requestedAuditCount(batchId)).toBe(1);
  });

  it("not_queued records the rows failed (NOT_QUEUED) so the batch completes; a record that arrives later still creates them (created overrides failed)", async () => {
    const batchId = randomUUID();
    const items = [recordItem(batchId, 1, no("n1")), recordItem(batchId, 2, no("n2"))];
    await publishNotQueued(batchId, 2, items); await drain();
    expect((await getStatus(batchId)).json()).toEqual({
      batchId, status: "completed", total: 2, created: 0, failed: 2, pending: 0,
      failedRows: [{ rowNo: 1, employeeNo: no("n1"), code: "NOT_QUEUED" }, { rowNo: 2, employeeNo: no("n2"), code: "NOT_QUEUED" }],
    });
    expect(await employeeExists(no("n1"))).toBe(false);

    await publishRecord(batchId, 2, items); await drain(); // the ambiguous publish was in fact delivered
    expect((await getStatus(batchId)).json()).toMatchObject({ status: "completed", total: 2, created: 2, failed: 0 });
    expect(await employeeExists(no("n1"))).toBe(true);
    expect(await requestedAuditCount(batchId)).toBe(1);
  });

  it("not_queued for rows a record command already recorded leaves them to be created (it never downgrades a recorded row)", async () => {
    const batchId = randomUUID();
    const items = [recordItem(batchId, 1, no("q1"))];
    await publishRecord(batchId, 1, items); await drain();
    await publishNotQueued(batchId, 1, items); await drain();
    expect((await getStatus(batchId)).json()).toMatchObject({ status: "completed", total: 1, created: 1, failed: 0 });
  });
});

describe("a queue failure part-way", () => {
  /** Run `fn` with queue.publish passing through to the real queue except where `failOn` says to throw. */
  async function withPublishFailure<T>(failOn: (topic: string, n: number) => boolean, fn: () => Promise<T>): Promise<T> {
    const real = queue.publish.bind(queue);
    let n = 0;
    const spy = vi.spyOn(queue, "publish").mockImplementation((topic, input) => {
      n++;
      if (failOn(topic, n)) return Promise.reject(new Error("broker down"));
      return real(topic, input);
    });
    try { return await fn(); } finally { spy.mockRestore(); }
  }
  const newBatchId = async (before: Set<string>): Promise<string> => {
    const all = await asTenant(TENANT, () => db.transaction((tx) => tx.select({ id: hrmsBulkImportBatches.id }).from(hrmsBulkImportBatches).where(eq(hrmsBulkImportBatches.tenantId, TENANT))));
    const created = all.find((b) => !before.has(b.id));
    expect(created).toBeDefined();
    return created!.id;
  };
  const batchIds = async (): Promise<Set<string>> =>
    new Set((await asTenant(TENANT, () => db.transaction((tx) => tx.select({ id: hrmsBulkImportBatches.id }).from(hrmsBulkImportBatches).where(eq(hrmsBulkImportBatches.tenantId, TENANT))))).map((b) => b.id));

  it("in the route (120 rows -> 2 record commands, the 2nd publish throws): answers 500, the first chunk is created, the never-queued rows end failed (NOT_QUEUED) instead of 'processing' forever", async () => {
    const before = await batchIds();
    const res = await withPublishFailure((topic, n) => topic === COMMANDS.employeeBulkImportRecord && n === 2,
      () => postBulk(Array.from({ length: 120 }, (_, i) => row(`f${i}`))));
    expect(res.statusCode).toBe(500);
    await drain();

    const batchId = await newBatchId(before);
    const rows = await batchRows(batchId);
    expect(rows).toHaveLength(120);
    expect(rows.slice(0, 100).every((r) => r.status === "created")).toBe(true);
    expect(rows.slice(100).map((r) => [r.rowNo, r.status, r.errorCode])).toEqual(Array.from({ length: 20 }, (_, i) => [101 + i, "failed", "NOT_QUEUED"]));
    expect((await getStatus(batchId)).json()).toMatchObject({ status: "completed", total: 120, created: 100, failed: 20, pending: 0 });
  });

  it("in the record consumer (a create publish throws part-way): the rows never handed to the queue end failed (NOT_QUEUED), the earlier ones are created, and nothing is retried or lost", async () => {
    const batchId = randomUUID();
    const items = [1, 2, 3].map((n) => recordItem(batchId, n, no(`k${n}`)));
    await withPublishFailure((topic, n) => topic === COMMANDS.employeeCreate && n === 3, async () => { // n: record, create#1, create#2 (throws)
      await publishRecord(batchId, 3, items);
      await drain();
    });
    await drain();

    const rows = await batchRows(batchId);
    expect(rows.map((r) => [r.rowNo, r.status, r.errorCode])).toEqual([[1, "created", null], [2, "failed", "NOT_QUEUED"], [3, "failed", "NOT_QUEUED"]]);
    expect(await employeeExists(no("k1"))).toBe(true);
    expect(await employeeExists(no("k2"))).toBe(false);
    expect((await getStatus(batchId)).json()).toMatchObject({ status: "completed", total: 3, created: 1, failed: 2, pending: 0 });
  });

  it("a row marked NOT_QUEUED but in fact delivered ends 'created' (the employee row is the ground truth)", async () => {
    const batchId = randomUUID();
    const id = randomUUID();
    await asTenant(TENANT, () => db.transaction(async (tx) => {
      await importRepo.insertBatch(tx, { id: batchId, tenantId: TENANT, requestedBy: ACTOR, correlationId: null, rows: [{ messageId: id, rowNo: 1, employeeNo: no("g1") }] });
      await importRepo.markRowFailed(tx, TENANT, id, "NOT_QUEUED");
    }));
    await queue.publish(COMMANDS.employeeCreate, {
      messageId: id, type: COMMANDS.employeeCreate, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { id, tenantId: TENANT, employeeNo: no("g1"), fullName: "Delivered After All", departmentId: deptId, designationId: desigId, dateOfJoining: "2026-01-01", employeeType: "permanent", basicMinor: 0, currency: "INR", importBatchId: batchId },
    });
    await drain();
    expect((await getStatus(batchId)).json()).toMatchObject({ status: "completed", created: 1, failed: 0 });
  });
});

describe("GET /bulk/status/:batchId -- scoping and gates", () => {
  it("404 for a random id", async () => {
    const r = await getStatus(randomUUID());
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
  });

  it("404 for another tenant's batch id (no cross-tenant disclosure)", async () => {
    const res = await postBulk([row("h1")]);
    const batchId = res.json<{ id: string }>().id;
    await drain();
    expect((await getStatus(batchId)).statusCode).toBe(200);
    expect((await getStatus(batchId, OTHER_TENANT)).statusCode).toBe(404);
  });

  it("400 for a non-uuid id; 403 for roles outside the bulk-import tier", async () => {
    expect((await getStatus("not-a-uuid")).statusCode).toBe(400);
    for (const role of ["hr_officer", "employee", "manager"]) expect((await getStatus(randomUUID(), TENANT, [role])).statusCode).toBe(403);
  });
});
