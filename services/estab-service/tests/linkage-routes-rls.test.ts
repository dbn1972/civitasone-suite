/**
 * estab-service — linkage routes RLS regression test.
 *
 * Regression for a silent-empty-result bug: linkage/routes.ts queries
 * `sqlClient` (raw postgres.js client) directly against `files.estab_files`
 * and `files.module_decision_log` — both RLS-ENABLEd AND FORCEd. The service
 * connects as `estab_svc` (rolsuper=false, rolbypassrls=false). This module
 * has no Drizzle schema for a composite by-ref/decision-log read, so there is
 * no `db.transaction()` — the only place `wrapWithTenantGuc` sets
 * `app.tenant_id` — anywhere in the call path. Without it, RLS fails CLOSED:
 * both raw queries return SUCCESS with EMPTY rows for every tenant, silently.
 *
 * `GET /v1/estab/files/by-ref` then always threw a 404 "not found" for a file
 * that genuinely exists, and `GET /v1/estab/files/:id/decision-log` always
 * returned an empty array regardless of real decision history.
 *
 * This test seeds a real file + decision-log row through the tenant-scoped
 * path (Drizzle `db.transaction()`, which DOES set the GUC) and asserts both
 * routes can see them — mirroring
 * services/helpdesk-service/tests/sla-engine-routes.test.ts.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { estabFiles } from "../src/modules/files/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "0e1a5e00-4000-4000-8000-000000000601";
const ACTOR = "0e1a5e00-5000-4000-8000-000000000601";
const FILE = "0e1a5e00-6000-4000-8000-000000000601";
const REF_ID = "0e1a5e00-7000-4000-8000-000000000601";
const REF_TYPE = "finance_sanction";

function authHeader(roles = ["estab_officer", "super_admin"], tenantId = TENANT) {
  const token = signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-linkage-601" }, SECRET, 3600);
  return { authorization: `Bearer ${token}` };
}

async function cleanup() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM files.module_decision_log WHERE tenant_id = ${TENANT}`);
      await tx.delete(estabFiles).where(eq(estabFiles.tenantId, TENANT));
    }),
  );
}

/** Seed a module-linked file plus a decision-log entry via the GUC-setting path. */
async function seedLinkedFile(): Promise<void> {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.insert(estabFiles).values({
        id: FILE, tenantId: TENANT, fileNo: "FIN/2026/0601", subject: "Sanction approval",
        dept: "FIN", priority: "normal", classification: "confidential",
        currentWith: ACTOR, status: "active", createdBy: ACTOR, updatedBy: ACTOR, version: 1,
      });
      await tx.execute(sql`
        UPDATE files.estab_files
        SET source_ref_type = ${REF_TYPE}, source_ref_id = ${REF_ID},
            initiated_by = ${ACTOR}, approval_chain = 'finance_sanction_chain'
        WHERE id = ${FILE} AND tenant_id = ${TENANT}
      `);
      await tx.execute(sql`
        INSERT INTO files.module_decision_log
          (id, tenant_id, file_id, source_ref_type, source_ref_id, decision, callback_topic, decided_by)
        VALUES
          (${randomUUID()}, ${TENANT}, ${FILE}, ${REF_TYPE}, ${REF_ID}, 'approved', 'finance.sanction.file_decided', ${ACTOR})
      `);
    }),
  );
}

beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("GET /v1/estab/files/by-ref", () => {
  it("sees a seeded file by source reference (regression: raw sqlClient query bypassed RLS GUC and always returned empty)", async () => {
    await seedLinkedFile();

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/estab/files/by-ref?refType=${REF_TYPE}&refId=${REF_ID}`,
      headers: authHeader(),
    });
    await app.close();

    // Before the fix: rows.length === 0 always (RLS fails closed with no GUC
    // set), so the route always threw 404 regardless of the seeded file.
    expect(res.statusCode).toBe(200);
    expect(res.json().data.id).toBe(FILE);
    expect(res.json().data.fileNo ?? res.json().data.file_no).toBe("FIN/2026/0601");
  });

  it("tenant isolation: another tenant cannot see this tenant's file via by-ref", async () => {
    await seedLinkedFile();
    const OTHER_TENANT = "0e1a5e00-8000-4000-8000-000000000602";

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/estab/files/by-ref?refType=${REF_TYPE}&refId=${REF_ID}`,
      headers: authHeader(["estab_officer", "super_admin"], OTHER_TENANT),
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });

  it("returns 404 when no file matches the reference", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/estab/files/by-ref?refType=${REF_TYPE}&refId=${randomUUID()}`,
      headers: authHeader(),
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for an invalid refType", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/estab/files/by-ref?refType=not_a_real_type&refId=${randomUUID()}`,
      headers: authHeader(),
    });
    await app.close();

    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/estab/files/by-ref?refType=${REF_TYPE}&refId=${randomUUID()}`,
    });
    await app.close();

    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role without access", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/estab/files/by-ref?refType=${REF_TYPE}&refId=${randomUUID()}`,
      headers: authHeader(["citizen"]),
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/estab/files/:id/decision-log", () => {
  it("sees the seeded decision-log entry (regression: raw sqlClient query bypassed RLS GUC and always returned empty)", async () => {
    await seedLinkedFile();

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/estab/files/${FILE}/decision-log`,
      headers: authHeader(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ decision: string }>;
    // Before the fix: always [] regardless of real decision history.
    expect(data.length).toBe(1);
    expect(data[0]?.decision).toBe("approved");
  });

  it("tenant isolation: another tenant sees an empty decision-log for this file id", async () => {
    await seedLinkedFile();
    const OTHER_TENANT = "0e1a5e00-8000-4000-8000-000000000602";

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/estab/files/${FILE}/decision-log`,
      headers: authHeader(["estab_officer", "super_admin"], OTHER_TENANT),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/estab/files/${randomUUID()}/decision-log` });
    await app.close();

    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role without access", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/estab/files/${randomUUID()}/decision-log`,
      headers: authHeader(["citizen"]),
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });
});
