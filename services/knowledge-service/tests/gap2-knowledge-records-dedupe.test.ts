/**
 * GAP2-KNOWLEDGE-RECORDS-01 review fix: listRecords must return each document
 * exactly once even when its category matches several categories (name/slug
 * collision, name is not unique) or a category has several retention policies.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = "cccccccc-0000-4000-8000-00000000e002";
const adminTok = signToken({ sub: ACTOR, tid: TENANT, roles: ["knowledge_admin"], sid: "sess-records-dedupe" }, SECRET, 3600);

const CAT_SLUG = randomUUID(); // name "Legal Matters", slug "legal"
const CAT_NAME = randomUUID(); // name "legal", slug "legal-old"
const CAT_TWO_POL = randomUUID();
const DOC_COLLIDE = randomUUID();
const DOC_TWO_POL = randomUUID();

let app: FastifyInstance;

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
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    // doc.category = 'legal' matches CAT_SLUG by slug and CAT_NAME by name.
    await sql`INSERT INTO knowledge.categories (id, tenant_id, name, slug, created_by, updated_by)
      VALUES (${CAT_SLUG}, ${TENANT}, 'Legal Matters', 'legal', ${ACTOR}, ${ACTOR}),
             (${CAT_NAME}, ${TENANT}, 'legal', 'legal-old', ${ACTOR}, ${ACTOR}),
             (${CAT_TWO_POL}, ${TENANT}, 'Audit', 'audit', ${ACTOR}, ${ACTOR})`;
    await sql`INSERT INTO knowledge.retention_policies
        (id, tenant_id, name, category_id, retention_years, retention_days, action, created_by, updated_by)
      VALUES (${randomUUID()}, ${TENANT}, 'Legal 3yr', ${CAT_SLUG}, 3, 0, 'archive', ${ACTOR}, ${ACTOR}),
             (${randomUUID()}, ${TENANT}, 'Legal-old 9yr', ${CAT_NAME}, 9, 0, 'archive', ${ACTOR}, ${ACTOR}),
             (${randomUUID()}, ${TENANT}, 'Audit 2yr', ${CAT_TWO_POL}, 2, 0, 'archive', ${ACTOR}, ${ACTOR}),
             (${randomUUID()}, ${TENANT}, 'Audit 7yr', ${CAT_TWO_POL}, 7, 0, 'destroy', ${ACTOR}, ${ACTOR})`;
    await sql`INSERT INTO knowledge.documents (id, tenant_id, title, category, status, created_by, updated_by)
      VALUES (${DOC_COLLIDE}, ${TENANT}, 'Collide', 'legal', 'approved', ${ACTOR}, ${ACTOR}),
             (${DOC_TWO_POL}, ${TENANT}, 'Two policies', 'Audit', 'approved', ${ACTOR}, ${ACTOR})`;
  });
});
afterAll(async () => { await cleanup(); await app.close(); await sqlClient.end(); });

type Rec = { id: string; department?: string; retentionPeriod?: string };

describe("listRecords — one row per document", () => {
  it("returns each document id exactly once and resolves deterministically", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/knowledge/records",
      headers: { authorization: `Bearer ${adminTok}` },
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Rec[];
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((i) => i === DOC_COLLIDE)).toHaveLength(1);
    expect(ids.filter((i) => i === DOC_TWO_POL)).toHaveLength(1);
    // slug match wins over name match
    const collide = rows.find((r) => r.id === DOC_COLLIDE)!;
    expect(collide.department).toBe("Legal Matters");
    expect(collide.retentionPeriod).toBe("3 years");
    // longest retention wins when a category has two policies
    expect(rows.find((r) => r.id === DOC_TWO_POL)!.retentionPeriod).toBe("7 years");
  });

  it("pagination is not distorted by fan-out", async () => {
    const res = await app.inject({
      method: "GET", url: "/v1/knowledge/records?limit=1&offset=1",
      headers: { authorization: `Bearer ${adminTok}` },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as Rec[]).length).toBe(1);
  });
});
