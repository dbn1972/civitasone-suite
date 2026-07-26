/**
 * data-migration + bulk master-data — REAL round-trip tests (CAP-020).
 *
 * Proves the previously-facade import/export actually persist: the import
 * consumer validates records, inserts the valid ones into tenant.org_units and
 * records a per-record error report; the export consumer materialises the rows
 * into a stored payload with a real count. Also proves migration/reconciliation
 * persistence and tenant isolation under FORCED RLS.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { runWithTenant } from "@civitasone/db";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { migrations, reconciliations, importBatches, exportJobs } from "../src/modules/data-migration/schema.js";
import { orgUnits } from "../src/modules/org-hierarchy/schema.js";
import { registerDataMigrationConsumers } from "../src/modules/data-migration/consumer.js";
import * as repo from "../src/modules/data-migration/repo.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TA = "aaaaaaaa-1111-4000-8000-0000000000e1";
const TB = "aaaaaaaa-1111-4000-8000-0000000000e2";
const ACTOR = "cccccccc-3333-4000-8000-0000000000e1";
const admin = (tid: string) => signToken({ sub: ACTOR, tid, roles: ["platform_admin", "super_admin"], sid: "s1" }, SECRET);

async function wipe(tenantId: string): Promise<void> {
  await runWithTenant(tenantId, () => db.transaction(async (tx) => {
    await tx.delete(orgUnits).where(eq(orgUnits.tenantId, tenantId));
    await tx.delete(importBatches).where(eq(importBatches.tenantId, tenantId));
    await tx.delete(exportJobs).where(eq(exportJobs.tenantId, tenantId));
    await tx.delete(migrations).where(eq(migrations.tenantId, tenantId));
    await tx.delete(reconciliations).where(eq(reconciliations.tenantId, tenantId));
  }));
}

async function publish(q: MemoryQueue, topic: string, tenantId: string, payload: Record<string, unknown>): Promise<void> {
  await q.publish(topic, { messageId: randomUUID(), type: topic, tenantId, actorId: ACTOR, correlationId: `c-${randomUUID()}`, schemaVersion: "1.0", payload });
  await q.drain();
}

async function inject(m: string, u: string, tid?: string, p?: unknown): Promise<{ status: number; body: unknown }> {
  const app = await buildApp();
  const o: { method: string; url: string; headers?: Record<string, string>; payload?: unknown } = { method: m, url: u };
  if (tid) o.headers = { authorization: `Bearer ${admin(tid)}` };
  if (p !== undefined) o.payload = p;
  const r = await app.inject(o); await app.close();
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
}

describe("data-migration + bulk master-data — real persistence (CAP-020)", () => {
  beforeAll(async () => { await wipe(TA); await wipe(TB); });
  afterAll(async () => { await wipe(TA); await wipe(TB); await sqlClient.end(); });

  it("migration.start persists and completes", async () => {
    const q = new MemoryQueue(); registerDataMigrationConsumers(q); await q.start();
    const id = randomUUID();
    await publish(q, "tenant.migration.start", TA, { id, sourceTenantId: randomUUID(), targetTenantId: randomUUID(), entities: ["employees"], dryRun: false });
    await q.stop();
    const m = await repo.findMigration(TA, id);
    expect(m).toBeDefined();
    expect(m?.status).toBe("completed");
  });

  it("import validates + persists valid records and reports per-record errors", async () => {
    const q = new MemoryQueue(); registerDataMigrationConsumers(q); await q.start();
    const batchId = randomUUID();
    const records = [
      { name: "HR", type: "department" },              // valid
      { name: "", type: "unit" },                       // invalid: no name
      { name: "X", type: "bogus" },                     // invalid: bad type
      { name: "Finance", type: "division", code: "FIN" }, // valid
      { name: "Dup", type: "unit", code: "FIN" },       // invalid: duplicate code
    ];
    await publish(q, "tenant.master_data.import", TA, { batchId, entityType: "org_unit", records });
    await q.stop();

    const batch = await repo.findImportBatch(TA, batchId);
    expect(batch).toBeDefined();
    expect(batch?.status).toBe("completed");
    expect(batch?.total).toBe(5);
    expect(batch?.inserted).toBe(2);
    expect(batch?.failed).toBe(3);
    expect((batch?.errors as { index: number; error: string }[]).map((e) => e.index).sort()).toEqual([1, 2, 4]);

    // The two valid records were REALLY inserted into org_units.
    const units = await runWithTenant(TA, () => db.transaction((tx) => tx.select().from(orgUnits).where(eq(orgUnits.tenantId, TA))));
    expect(units.map((u) => u.name).sort()).toEqual(["Finance", "HR"]);
  });

  it("export materialises the tenant's rows into a stored payload with a real count", async () => {
    const q = new MemoryQueue(); registerDataMigrationConsumers(q); await q.start();
    const exportId = randomUUID();
    await publish(q, "tenant.master_data.export", TA, { exportId, entityType: "org_unit", format: "json" });
    await q.stop();

    const job = await repo.findExportJob(TA, exportId);
    expect(job).toBeDefined();
    expect(job?.status).toBe("completed");
    // TA has exactly the 2 units inserted by the import test above.
    expect(job?.recordCount).toBe(2);
    const parsed = JSON.parse(job?.payload ?? "[]") as { name: string }[];
    expect(parsed.map((r) => r.name).sort()).toEqual(["Finance", "HR"]);
  });

  it("import batches are tenant-isolated under FORCED RLS", async () => {
    const q = new MemoryQueue(); registerDataMigrationConsumers(q); await q.start();
    const batchId = randomUUID();
    await publish(q, "tenant.master_data.import", TB, { batchId, entityType: "org_unit", records: [{ name: "TB-Only", type: "department" }] });
    await q.stop();
    // TB can see its batch...
    expect(await repo.findImportBatch(TB, batchId)).toBeDefined();
    // ...but TA cannot (RLS scoping by tenant).
    expect(await repo.findImportBatch(TA, batchId)).toBeUndefined();
  });

  it("HTTP: import/export status routes return persisted results; 404 for unknown", async () => {
    // Seed a batch via consumer, then read it back over HTTP.
    const q = new MemoryQueue(); registerDataMigrationConsumers(q); await q.start();
    const batchId = randomUUID();
    await publish(q, "tenant.master_data.import", TA, { batchId, entityType: "org_unit", records: [{ name: "Ops", type: "unit" }] });
    await q.stop();

    const got = await inject("GET", `/v1/org/master-data/import/${batchId}`, TA);
    expect(got.status).toBe(200);
    expect((got.body as { data: { id: string } }).data.id).toBe(batchId);

    const missing = await inject("GET", `/v1/org/master-data/export/${randomUUID()}`, TA);
    expect(missing.status).toBe(404);
  });

  it("HTTP: 202 on migration/reconciliation submit, 401 without auth, 400 bad payload", async () => {
    expect((await inject("POST", "/v1/org/migrations", TA, { sourceTenantId: randomUUID(), targetTenantId: randomUUID(), entities: ["e"] })).status).toBe(202);
    expect((await inject("POST", "/v1/org/reconciliation", TA, { tenantId: randomUUID(), entityType: "employees", sourceSystem: "eHRMS" })).status).toBe(202);
    expect((await inject("GET", "/v1/org/migrations")).status).toBe(401);
    expect((await inject("POST", "/v1/org/migrations", TA, { entities: [] })).status).toBe(400);
  });

  // FINDING 1 (HIGH): an oversized field must NOT discard the whole batch. The
  // valid rows persist, the batch header COMMITS (status retrievable, never a
  // permanent 404), and the error report names the offending row with a reason.
  it("oversized name is reported (not silently dropped) and the batch is NOT discarded", async () => {
    const q = new MemoryQueue(); registerDataMigrationConsumers(q); await q.start();
    const batchId = randomUUID();
    const longName = "Z".repeat(201); // > varchar(200)
    const records = [
      { name: "OversizeValidA", type: "department" }, // valid
      { name: longName, type: "department" },         // invalid: name too long
      { name: "OversizeValidB", type: "unit" },       // valid
    ];
    await publish(q, "tenant.master_data.import", TA, { batchId, entityType: "org_unit", records });
    await q.stop();

    // Batch header COMMITTED and retrievable (the whole batch was NOT rolled back).
    const batch = await repo.findImportBatch(TA, batchId);
    expect(batch).toBeDefined();
    expect(batch?.status).toBe("completed"); // valid rows inserted → not "failed"
    expect(batch?.total).toBe(3);
    expect(batch?.inserted).toBe(2);
    expect(batch?.failed).toBe(1);
    const errs = batch?.errors as { index: number; error: string }[];
    expect(errs.map((e) => e.index)).toEqual([1]);
    expect(errs[0]?.error).toMatch(/exceeds 200/);

    // The two valid rows really persisted alongside the rejected one.
    const units = await runWithTenant(TA, () => db.transaction((tx) => tx.select().from(orgUnits).where(eq(orgUnits.tenantId, TA))));
    const names = units.map((u) => u.name);
    expect(names).toContain("OversizeValidA");
    expect(names).toContain("OversizeValidB");
    expect(names).not.toContain(longName);

    // Status route returns 200 (not 404-forever) with the error report.
    const got = await inject("GET", `/v1/org/master-data/import/${batchId}`, TA);
    expect(got.status).toBe(200);
    expect((got.body as { data: { failed: number } }).data.failed).toBe(1);
  });
});
