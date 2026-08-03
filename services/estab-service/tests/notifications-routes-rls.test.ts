/**
 * estab-service — notifications feed RLS regression test.
 *
 * Regression for a silent-empty-result bug: notifications/queries.ts queries
 * a tier-routed raw postgres.js client (`sqlClientFor(tenantId)`) directly
 * against `files.estab_files`, `files.estab_dfa` and `files.module_decision_log`
 * — all three RLS-ENABLEd AND FORCEd. The service connects as `estab_svc`
 * (rolsuper=false, rolbypassrls=false). This module has no Drizzle schema for
 * these composite reads, so there is no `db.transaction()` — the only place
 * `wrapWithTenantGuc` sets `app.tenant_id` — anywhere in the call path.
 * Without it, RLS fails CLOSED: every query returns SUCCESS with EMPTY rows
 * for every tenant, silently. `GET /v1/estab/notifications` therefore always
 * returned an empty feed, regardless of overdue files, pending DFAs, or
 * recent decisions actually on record.
 *
 * This test seeds an overdue file, a DFA pending approval, and a decision-log
 * entry through the tenant-scoped path (Drizzle `db.transaction()`, which DOES
 * set the GUC) and asserts the route surfaces all of them.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { estabFiles } from "../src/modules/files/schema.js";
import { estabDfa } from "../src/modules/dfa/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "0f1a5e00-4000-4000-8000-000000000701";
const ACTOR = "0f1a5e00-5000-4000-8000-000000000701";
const OVERDUE_FILE = "0f1a5e00-6000-4000-8000-000000000701";
const PENDING_DFA = "0f1a5e00-7000-4000-8000-000000000701";
const DECIDED_FILE = "0f1a5e00-8000-4000-8000-000000000701";

function authHeader(roles = ["estab_officer", "super_admin"], tenantId = TENANT) {
  const token = signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-notif-701" }, SECRET, 3600);
  return { authorization: `Bearer ${token}` };
}

async function cleanup() {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      await tx.execute(sql`DELETE FROM files.module_decision_log WHERE tenant_id = ${TENANT}`);
      await tx.delete(estabDfa).where(eq(estabDfa.tenantId, TENANT));
      await tx.delete(estabFiles).where(eq(estabFiles.tenantId, TENANT));
    }),
  );
}

async function seedNotificationSources(): Promise<void> {
  await runWithTenant(TENANT, () =>
    db.transaction(async (tx) => {
      // Overdue active file.
      await tx.insert(estabFiles).values({
        id: OVERDUE_FILE, tenantId: TENANT, fileNo: "EST/2026/0701", subject: "Overdue file",
        dept: "GEN", priority: "normal", classification: "public", currentWith: ACTOR,
        status: "active", createdBy: ACTOR, updatedBy: ACTOR, version: 1,
      });
      await tx.execute(sql`
        UPDATE files.estab_files SET due_by = NOW() - INTERVAL '2 days'
        WHERE id = ${OVERDUE_FILE} AND tenant_id = ${TENANT}
      `);

      // DFA awaiting approval.
      await tx.insert(estabDfa).values({
        id: PENDING_DFA, tenantId: TENANT, dfaNo: "DFA/2026/0701", communicationType: "letter",
        subject: "Awaiting approval", body: "Draft body", status: "pending_approval",
        decisionModality: "approved", createdBy: ACTOR, updatedBy: ACTOR, version: 1,
      });

      // A decided file with a module_decision_log entry.
      await tx.insert(estabFiles).values({
        id: DECIDED_FILE, tenantId: TENANT, fileNo: "EST/2026/0702", subject: "Decided file",
        dept: "GEN", priority: "normal", classification: "public", currentWith: ACTOR,
        status: "active", createdBy: ACTOR, updatedBy: ACTOR, version: 1,
      });
      await tx.execute(sql`
        UPDATE files.estab_files
        SET source_ref_type = 'finance_sanction', source_ref_id = ${randomUUID()}
        WHERE id = ${DECIDED_FILE} AND tenant_id = ${TENANT}
      `);
      await tx.execute(sql`
        INSERT INTO files.module_decision_log
          (id, tenant_id, file_id, source_ref_type, source_ref_id, decision, callback_topic, decided_by)
        VALUES
          (${randomUUID()}, ${TENANT}, ${DECIDED_FILE}, 'finance_sanction', ${randomUUID()}, 'approved', 'finance.sanction.file_decided', ${ACTOR})
      `);
    }),
  );
}

beforeEach(cleanup);
afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("GET /v1/estab/notifications", () => {
  it("surfaces the seeded overdue file, pending DFA, and decision (regression: raw sqlClient query bypassed RLS GUC and always returned empty)", async () => {
    await seedNotificationSources();

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/notifications?limit=50",
      headers: authHeader(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ kind: string; id: string }>;
    // Before the fix: [] always (RLS fails closed with no GUC set), regardless
    // of real overdue files / pending DFAs / decisions on record.
    expect(data.length).toBeGreaterThanOrEqual(3);
    expect(data.some((n) => n.kind === "file_overdue" && n.id === `overdue:${OVERDUE_FILE}`)).toBe(true);
    expect(data.some((n) => n.kind === "dfa_pending_approval" && n.id === `dfa_pa:${PENDING_DFA}`)).toBe(true);
    expect(data.some((n) => n.kind === "module_decision")).toBe(true);
  });

  it("tenant isolation: another tenant sees no notifications from this tenant's data", async () => {
    await seedNotificationSources();
    const OTHER_TENANT = "0f1a5e00-9000-4000-8000-000000000702";

    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/notifications?limit=50",
      headers: authHeader(["estab_officer", "super_admin"], OTHER_TENANT),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("returns 200 with an empty feed when there is nothing to notify about", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/notifications",
      headers: authHeader(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("returns 400 for an out-of-range limit", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/notifications?limit=0",
      headers: authHeader(),
    });
    await app.close();

    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without a token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/estab/notifications" });
    await app.close();

    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for a role without access", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/estab/notifications",
      headers: authHeader(["citizen"]),
    });
    await app.close();

    expect(res.statusCode).toBe(403);
  });
});
