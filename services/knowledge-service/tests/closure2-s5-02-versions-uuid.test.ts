/**
 * CLOS2-S5-02: versions routes never UUID-checked versionId (any caller) or
 * documentId (callers with no clearance filter, i.e. admin), so uuid columns
 * received a malformed value -> Postgres 22P02 -> retryable 500. They now
 * answer 404, the same as a non-admin already got for a bad documentId.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000001";
const DOC = "dddddddd-1111-4000-8000-0000000000ff";
const VER = "11111111-2222-4000-8000-0000000000ff";
const tok = (roles: string[]) => signToken({ sub: "user-001", tid: TENANT, roles, sid: "sess-001" }, SECRET);

const SEEDED = randomUUID();
const ACTOR = randomUUID();
beforeAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config(${"app.tenant_id"}, ${TENANT}, true)`;
    await sql`INSERT INTO knowledge.documents (id, tenant_id, title, category, status, access_level, created_by, updated_by)
              VALUES (${SEEDED}, ${TENANT}, ${"clos2-s5-02"}, ${"clos2"}, ${"approved"}, ${"public"}, ${ACTOR}, ${ACTOR})`;
  });
});
afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config(${"app.tenant_id"}, ${TENANT}, true)`;
    await sql`DELETE FROM knowledge.documents WHERE id = ${SEEDED}`;
  });
  await sqlClient.end();
});

async function call(roles: string[], method: "GET" | "POST", url: string, payload?: object) {
  const app = await buildApp();
  const res = await app.inject({ method, url, headers: { authorization: `Bearer ${tok(roles)}` }, ...(payload ? { payload } : {}) });
  await app.close();
  return res;
}

describe("CLOS2-S5-02: versions path ids", () => {
  it("(a) admin: GET /documents/xyz/versions is 404", async () => {
    expect((await call(["knowledge_admin"], "GET", "/v1/knowledge/documents/xyz/versions")).statusCode).toBe(404);
  });
  it("(b) knowledge_user: GET /documents/<visible uuid>/versions/xyz is 404", async () => {
    expect((await call(["knowledge_user"], "GET", `/v1/knowledge/documents/${SEEDED}/versions/xyz`)).statusCode).toBe(404);
  });
  it("(c) admin: GET /documents/<uuid>/versions/xyz is 404", async () => {
    expect((await call(["knowledge_admin"], "GET", `/v1/knowledge/documents/${DOC}/versions/xyz`)).statusCode).toBe(404);
  });
  it("admin: POST create + restore with malformed ids are 404, not 500", async () => {
    expect((await call(["knowledge_admin"], "POST", "/v1/knowledge/documents/xyz/versions", {})).statusCode).toBe(404);
    expect((await call(["knowledge_admin"], "POST", `/v1/knowledge/documents/${DOC}/versions/xyz/restore`, {})).statusCode).toBe(404);
  });
  it("(d) valid ids keep existing behaviour: unknown version 404, list 200", async () => {
    expect((await call(["knowledge_admin"], "GET", `/v1/knowledge/documents/${DOC}/versions/${VER}`)).statusCode).toBe(404);
    expect((await call(["knowledge_admin"], "GET", `/v1/knowledge/documents/${DOC}/versions`)).statusCode).toBe(200);
  });
});
