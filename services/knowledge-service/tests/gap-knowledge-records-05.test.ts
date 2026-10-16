/**
 * GAP-KNOWLEDGE-RECORDS-05 — GET /v1/knowledge/records must authenticate,
 * tenant-scope, restrict by record classification/retention, and return
 * expiry/retention dates the page uses for its 30-day window.
 *
 * Given: tenant A has a document; tenant B has a separate document.
 * When:  tenant A employee GETs /v1/knowledge/records.
 * Then:  200 with only tenant A rows; tenant B rows are absent.
 * And:   a request without an auth token returns 401.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET as string;

const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const ACTOR_A = randomUUID();
const ACTOR_B = randomUUID();

const DOC_A_ID = randomUUID();
const DOC_B_ID = randomUUID();

function tok(sub: string, tid: string) {
  return signToken({ sub, tid, roles: ["knowledge_admin"], sid: "sess-rec05" }, SECRET, 3600);
}

let app: FastifyInstance;

async function seed(): Promise<void> {
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT_A}, true)`;
    await sql`
      INSERT INTO knowledge.documents (id, tenant_id, title, category, status, created_by, updated_by)
      VALUES (${DOC_A_ID}, ${TENANT_A}, ${"Tenant A Record"}, ${"Finance"}, ${"approved"}, ${ACTOR_A}, ${ACTOR_A})`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT_B}, true)`;
    await sql`
      INSERT INTO knowledge.documents (id, tenant_id, title, category, status, created_by, updated_by)
      VALUES (${DOC_B_ID}, ${TENANT_B}, ${"Tenant B Record"}, ${"HR"}, ${"approved"}, ${ACTOR_B}, ${ACTOR_B})`;
  });
}

async function cleanup(): Promise<void> {
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT_A}, true)`;
    await sql`DELETE FROM knowledge.documents WHERE id = ${DOC_A_ID}`;
  });
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT_B}, true)`;
    await sql`DELETE FROM knowledge.documents WHERE id = ${DOC_B_ID}`;
  });
}

beforeAll(async () => {
  app = await buildApp();
  await cleanup();
  await seed();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("GAP-KNOWLEDGE-RECORDS-05 — /v1/knowledge/records auth and tenant isolation", () => {
  it("returns 401 when no auth token is provided", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/knowledge/records",
    });
    expect(res.statusCode).toBe(401);
  });

  it("tenant A employee sees only tenant A records (200 with own row, no tenant B row)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/knowledge/records",
      headers: { authorization: `Bearer ${tok(ACTOR_A, TENANT_A)}` },
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ id: string }>;
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(DOC_A_ID);
    expect(ids).not.toContain(DOC_B_ID);
  });

  it("tenant B employee sees only tenant B records (no tenant A row)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v1/knowledge/records",
      headers: { authorization: `Bearer ${tok(ACTOR_B, TENANT_B)}` },
    });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as Array<{ id: string }>;
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain(DOC_A_ID);
    expect(ids).toContain(DOC_B_ID);
  });
});
