/**
 * OWNER DECISION #23 (TENANT-DATA-MIGRATION-01): a failed import is retried for
 * its FAILED records only; the error report downloads as CSV (row, field, error);
 * only the migration admin may retry; the retry is audited. Real Postgres, real
 * consumers, real routes.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { queue as infraQueue } from "../src/shared/infra.js";
import { db, sqlClient } from "../src/shared/db.js";
import { importBatches } from "../src/modules/data-migration/schema.js";
import { orgUnits } from "../src/modules/org-hierarchy/schema.js";
import { registerDataMigrationConsumers } from "../src/modules/data-migration/consumer.js";
import { outboxMessages } from "../src/shared/outbox.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const T = "aaaaaaaa-1111-4000-8000-0000000023a1";
const OTHER = "aaaaaaaa-1111-4000-8000-0000000023a2";
const ADMIN = "cccccccc-3333-4000-8000-0000000023a1";
const MIG = "cccccccc-3333-4000-8000-0000000023a2";
const tok = (tid: string, sub: string, roles: string[]) => signToken({ sub, tid, roles, sid: "s1" }, SECRET);

async function call(m: string, u: string, tid: string, sub: string, roles: string[], payload?: unknown) {
  const app = await buildApp();
  const r = await app.inject({ method: m as "GET", url: u, headers: { authorization: `Bearer ${tok(tid, sub, roles)}` }, ...(payload !== undefined ? { payload: payload as object } : {}) });
  await app.close();
  return { status: r.statusCode, body: r.body, headers: r.headers, json: () => (r.body ? JSON.parse(r.body) : undefined) };
}
const batchRow = async (id: string) => (await runWithTenant(T, () => db.transaction((tx) => tx.select().from(importBatches).where(eq(importBatches.id, id)))))[0]!;
const units = () => runWithTenant(T, () => db.transaction((tx) => tx.select().from(orgUnits).where(eq(orgUnits.tenantId, T))));

const PARENT = randomUUID();
let batchId: string;

async function wipe() {
  for (const t of [T, OTHER]) await runWithTenant(t, () => db.transaction(async (tx) => {
    await tx.delete(orgUnits).where(eq(orgUnits.tenantId, t));
    await tx.delete(importBatches).where(eq(importBatches.tenantId, t));
    await tx.delete(outboxMessages).where(eq(outboxMessages.tenantId, t));
  }));
}

describe("import retry + error report (owner decision #23)", () => {
  beforeAll(async () => {
    await wipe();
    registerDataMigrationConsumers(infraQueue);
    await infraQueue.start();
    const created = await call("POST", "/v1/org/master-data/import", T, ADMIN, ["super_admin"], {
      entityType: "org_unit",
      records: [
        { name: "HR", type: "department" },                         // row 1 ok
        { name: "Finance", type: "division", code: "FIN" },          // row 2 ok
        { name: "Payroll", type: "unit", parentId: PARENT },         // row 3 fails: parent not there yet
        { name: "Bogus", type: "nonsense" },                         // row 4 fails: bad type
        { name: "", type: "unit" },                                  // row 5 fails: name
      ],
    });
    expect(created.status).toBe(202);
    batchId = created.json().data.batchId;
    await infraQueue.drain();
  });
  afterAll(async () => { await wipe(); await sqlClient.end(); });

  it("the batch remembers exactly its failed records and a per-record report with row and field", async () => {
    const b = await batchRow(batchId);
    expect(b.inserted).toBe(2);
    expect(b.failed).toBe(3);
    expect(b.failedRecords.map((f) => f.index)).toEqual([2, 3, 4]);
    expect(b.errors).toEqual([
      { index: 2, row: 3, field: "parentId", error: `parent not found: ${PARENT}` },
      { index: 3, row: 4, field: "type", error: "invalid type: nonsense" },
      { index: 4, row: 5, field: "name", error: "name is required" },
    ]);
  });

  it("the CSV report has row, field, error and is readable by the migration admin; stored payloads are never returned", async () => {
    const r = await call("GET", `/v1/tenant/org/imports/${batchId}/errors.csv`, T, MIG, ["migration_admin"]);
    expect(r.status).toBe(200);
    expect(String(r.headers["content-type"])).toContain("text/csv");
    const lines = r.body.replace(/^﻿/, "").trim().split("\r\n");
    expect(lines[0]).toBe("row,field,error");
    expect(lines.slice(1)).toEqual([`3,parentId,parent not found: ${PARENT}`, "4,type,invalid type: nonsense", "5,name,name is required"]);
    const detail = await call("GET", `/v1/org/master-data/import/${batchId}`, T, MIG, ["migration_admin"]);
    expect(detail.json().data.retryable).toBe(true);
    expect(detail.body).not.toContain("failedRecords");
    expect(detail.body).not.toContain("Bogus");
  });

  it("only the migration admin may retry: super/platform/tenant admin and others get 403 and nothing changes", async () => {
    for (const roles of [["super_admin"], ["platform_admin"], ["tenant_admin"], ["employee"]]) {
      const r = await call("POST", `/v1/tenant/org/imports/${batchId}/retry`, T, ADMIN, roles);
      expect(r.status).toBe(403);
    }
    expect((await batchRow(batchId)).retryCount).toBe(0);
  });

  it("another tenant's migration admin gets 404", async () => {
    expect((await call("POST", `/v1/tenant/org/imports/${batchId}/retry`, OTHER, MIG, ["migration_admin"])).status).toBe(404);
    expect((await call("GET", `/v1/tenant/org/imports/${batchId}/errors.csv`, OTHER, MIG, ["migration_admin"])).status).toBe(404);
  });

  it("retry re-runs ONLY the failed records: recovered rows load once, loaded rows are not duplicated, the report shrinks", async () => {
    await runWithTenant(T, () => db.transaction((tx) => tx.insert(orgUnits).values({ id: PARENT, tenantId: T, name: "Admin Wing", type: "department", level: 1, createdBy: ADMIN, version: 1 })));
    const r = await call("POST", `/v1/tenant/org/imports/${batchId}/retry`, T, MIG, ["migration_admin"]);
    expect(r.status).toBe(202);
    expect(r.json().data).toMatchObject({ status: "retry_queued", records: 3 });
    await infraQueue.drain();

    const b = await batchRow(batchId);
    expect(b.inserted).toBe(3);
    expect(b.failed).toBe(2);
    expect(b.retryCount).toBe(1);
    expect(b.lastRetryBy).toBe(MIG);
    expect(b.failedRecords.map((f) => f.index)).toEqual([3, 4]);
    expect((b.errors as { row: number }[]).map((e) => e.row)).toEqual([4, 5]);
    expect((await units()).map((u) => u.name).sort()).toEqual(["Admin Wing", "Finance", "HR", "Payroll"]);
  });

  it("the retry is audited with the actor, attempt and counts", async () => {
    const rows = await runWithTenant(T, () => db.transaction((tx) => tx.select().from(outboxMessages).where(eq(outboxMessages.tenantId, T))));
    const audit = rows.filter((m) => (m.payload as { action?: string })?.action === "retry_failed_records");
    expect(audit).toHaveLength(1);
    expect(audit[0]!.payload).toMatchObject({ resourceType: "import_batch", resourceId: batchId, retried: 3, recovered: 1, stillFailing: 2, attempt: 1 });
    expect(audit[0]!.actorId).toBe(MIG);
  });

  it("a replayed retry command (same messageId) is applied once", async () => {
    const mq = new MemoryQueue(); registerDataMigrationConsumers(mq);
    const messageId = randomUUID();
    for (let i = 0; i < 2; i++) {
      await mq.publish("tenant.master_data.import.retry", { messageId, type: "tenant.master_data.import.retry", tenantId: T, actorId: MIG, correlationId: "c", schemaVersion: "1.0", payload: { batchId } });
      await mq.drain();
    }
    expect((await batchRow(batchId)).retryCount).toBe(2);
  });

  it("a batch with no failed records cannot be retried (409)", async () => {
    const created = await call("POST", "/v1/org/master-data/import", T, ADMIN, ["super_admin"], { entityType: "org_unit", records: [{ name: "Solo", type: "unit" }] });
    await infraQueue.drain();
    const r = await call("POST", `/v1/tenant/org/imports/${created.json().data.batchId}/retry`, T, MIG, ["migration_admin"]);
    expect(r.status).toBe(409);
    expect(r.json().code).toBe("NOTHING_TO_RETRY");
  });

  it("the list shows batches (without payloads) to the migration admin", async () => {
    const r = await call("GET", "/v1/tenant/org/imports", T, MIG, ["migration_admin"]);
    expect(r.status).toBe(200);
    expect(r.json().data.length).toBeGreaterThanOrEqual(2);
    expect(r.body).not.toContain("failedRecords");
    expect((await call("GET", "/v1/tenant/org/imports", T, ADMIN, ["tenant_admin"])).status).toBe(403);
  });
});
