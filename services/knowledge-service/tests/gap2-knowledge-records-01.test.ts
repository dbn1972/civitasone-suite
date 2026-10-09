/**
 * GAP2-KNOWLEDGE-RECORDS-01 — the Records Management view's retention columns
 * and review/weeding KPIs were structurally always empty/0 because
 * GET /v1/knowledge/records emitted no disposalDueDate / retentionPeriod /
 * department. After the fix the route joins each document to the retention
 * policy applied to its category and emits those fields.
 *
 * Before the fix: `disposalDueDate` and `retentionPeriod` were absent on every
 * row regardless of configured retention. This test fails on the old code.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr"; // gitleaks:allow
const TENANT = randomUUID();
const ACTOR = "cccccccc-0000-4000-8000-00000000e001";

function tok(roles: string[]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "sess-records01" }, SECRET, 3600);
}
const adminTok = tok(["knowledge_admin"]);

const CAT_ID = randomUUID();
const POLICY_ID = randomUUID();
const DOC_ID = randomUUID();
const DOC_NOPOLICY_ID = randomUUID();

let app: FastifyInstance;

async function seed(): Promise<void> {
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`
      INSERT INTO knowledge.categories (id, tenant_id, name, slug, created_by, updated_by)
      VALUES (${CAT_ID}, ${TENANT}, 'Finance Records', 'finance-records', ${ACTOR}, ${ACTOR})`;
    // 5-year retention policy on that category.
    await sql`
      INSERT INTO knowledge.retention_policies
        (id, tenant_id, name, category_id, retention_years, retention_days, action, created_by, updated_by)
      VALUES (${POLICY_ID}, ${TENANT}, 'Finance 5yr', ${CAT_ID}, 5, 0, 'destroy', ${ACTOR}, ${ACTOR})`;
    // A document in that category, created ~6 years ago → overdue for weeding.
    await sql`
      INSERT INTO knowledge.documents (id, tenant_id, title, category, status, created_by, updated_by, created_at, updated_at)
      VALUES (${DOC_ID}, ${TENANT}, 'Old Finance File', 'Finance Records', 'approved', ${ACTOR}, ${ACTOR},
              now() - interval '6 years', now())`;
    // A document in a category with no retention policy → no disposal date.
    await sql`
      INSERT INTO knowledge.documents (id, tenant_id, title, category, status, created_by, updated_by)
      VALUES (${DOC_NOPOLICY_ID}, ${TENANT}, 'Uncategorised Note', 'Misc', 'approved', ${ACTOR}, ${ACTOR})`;
  });
}

async function cleanup(): Promise<void> {
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM knowledge.documents WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM knowledge.retention_policies WHERE tenant_id = ${TENANT}`;
    await sql`DELETE FROM knowledge.categories WHERE tenant_id = ${TENANT}`;
  });
}

beforeAll(async () => {
  app = await buildApp();
  await cleanup();
  await seed();
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

type Rec = {
  id: string;
  disposalDueDate?: string;
  retentionPeriod?: string;
  department?: string;
};

describe("GAP2-KNOWLEDGE-RECORDS-01 — records carry applied-retention fields", () => {
  it("a document with an applied retention policy exposes disposalDueDate + retentionPeriod + department", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/knowledge/records",
      headers: { authorization: `Bearer ${adminTok}` },
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Rec[];
    const withPolicy = rows.find((r) => r.id === DOC_ID);
    expect(withPolicy).toBeDefined();
    expect(withPolicy!.disposalDueDate).toBeTruthy();
    expect(withPolicy!.retentionPeriod).toBe("5 years");
    expect(withPolicy!.department).toBe("Finance Records");
    // created 6y ago + 5y retention → disposal due is in the past (overdue for weeding).
    expect(withPolicy!.disposalDueDate! < new Date().toISOString().slice(0, 10)).toBe(true);
  });

  it("a document with no applied policy has no disposalDueDate (honest empty)", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/knowledge/records",
      headers: { authorization: `Bearer ${adminTok}` },
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Rec[];
    const noPolicy = rows.find((r) => r.id === DOC_NOPOLICY_ID);
    expect(noPolicy).toBeDefined();
    expect(noPolicy!.disposalDueDate).toBeUndefined();
    expect(noPolicy!.retentionPeriod).toBeUndefined();
  });
});
