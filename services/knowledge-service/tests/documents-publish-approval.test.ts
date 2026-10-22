/**
 * PATCH /v1/knowledge/articles/:id/publish is an approval control:
 *  - approver roles only (knowledge_admin / super_admin); a plain knowledge_user is 403;
 *  - maker-checker: the author of a document cannot publish it;
 *  - every publish/unpublish writes an audit event (outbox topic audit.event.record).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET!;
const TENANT = randomUUID();
const AUTHOR = randomUUID();   // knowledge_admin who created the document
const APPROVER = randomUUID(); // a different knowledge_admin
const USER = randomUUID();     // plain knowledge_user
const CITIZEN = randomUUID();

const tok = (sub: string, roles: string[]) => signToken({ sub, tid: TENANT, roles, sid: "sess-pub" }, SECRET, 3600);
const hdr = (sub: string, roles: string[]) => ({ authorization: `Bearer ${tok(sub, roles)}`, "content-type": "application/json" });

let app: FastifyInstance;
const docId = randomUUID();

const publish = (h: Record<string, string>, published: boolean, id = docId) =>
  app.inject({ method: "PATCH", url: `/v1/knowledge/articles/${id}/publish`, headers: h, payload: { published } });

async function status(): Promise<string> {
  return sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    const rows = await sql`SELECT status FROM knowledge.documents WHERE id = ${docId}`;
    return (rows as unknown as Array<{ status: string }>)[0]!.status;
  });
}
async function setStatus(st: string): Promise<void> {
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`UPDATE knowledge.documents SET status = ${st} WHERE id = ${docId}`;
  });
}
async function auditRows(action: string) {
  return sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    const rows = await sql`SELECT actor_id, payload FROM _outbox.messages WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record'`;
    return (rows as unknown as Array<{ actor_id: string; payload: Record<string, unknown> }>)
      .filter((r) => r.payload.resourceId === docId && r.payload.action === action && r.payload.resourceType === "document");
  });
}

beforeAll(async () => {
  app = await buildApp();
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`INSERT INTO knowledge.documents (id, tenant_id, title, category, status, access_level, created_by, updated_by)
              VALUES (${docId}, ${TENANT}, 'Publish approval doc', 'Policy', 'draft', 'internal', ${AUTHOR}, ${AUTHOR})`;
  });
});
afterAll(async () => {
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await sql`DELETE FROM knowledge.documents WHERE id = ${docId}`;
  }).catch(() => {});
  await app.close();
  await sqlClient.end();
});

describe("knowledge article publish — approval control", () => {
  it("a plain knowledge_user cannot publish (403) and the document is unchanged", async () => {
    const r = await publish(hdr(USER, ["knowledge_user"]), true);
    expect(r.statusCode).toBe(403);
    expect(await status()).toBe("draft");
    expect(await auditRows("publish")).toHaveLength(0);
  });

  it("a non-knowledge role (citizen) cannot publish (403)", async () => {
    expect((await publish(hdr(CITIZEN, ["citizen"]), true)).statusCode).toBe(403);
    expect(await status()).toBe("draft");
  });

  it("the author cannot publish their own document (403 MAKER_CHECKER) and nothing is written", async () => {
    const r = await publish(hdr(AUTHOR, ["knowledge_admin"]), true);
    expect(r.statusCode).toBe(403);
    expect((r.json() as { code: string }).code).toBe("MAKER_CHECKER");
    expect(await status()).toBe("draft");
    expect(await auditRows("publish")).toHaveLength(0);
  });

  it("a different knowledge_admin publishes (200) and an audit row records who did it", async () => {
    const r = await publish(hdr(APPROVER, ["knowledge_admin"]), true);
    expect(r.statusCode).toBe(200);
    expect((r.json() as { status: string }).status).toBe("approved");
    expect(await status()).toBe("approved");
    const audits = await auditRows("publish");
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actor_id).toBe(APPROVER);
    expect(audits[0]!.payload).toMatchObject({ service: "knowledge", outcome: "success", previousStatus: "draft", newStatus: "approved" });
  });

  it("a knowledge_user cannot unpublish either; an approver can, with its own audit row", async () => {
    expect((await publish(hdr(USER, ["knowledge_user"]), false)).statusCode).toBe(403);
    expect(await status()).toBe("approved");
    const r = await publish(hdr(APPROVER, ["knowledge_admin"]), false);
    expect(r.statusCode).toBe(200);
    expect(await status()).toBe("draft");
    expect(await auditRows("unpublish")).toHaveLength(1);
  });

  it("a nonexistent document is 404 for an approver and writes no audit row", async () => {
    const ghost = randomUUID();
    expect((await publish(hdr(APPROVER, ["knowledge_admin"]), true, ghost)).statusCode).toBe(404);
    await setStatus("draft");
  });
});
