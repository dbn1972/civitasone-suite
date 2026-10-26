/**
 * UAT owner decision #15 (GAP-KNOWLEDGE-DOCUMENTS-NEW-05):
 *   POST /v1/knowledge/documents with a title that already exists in the tenant
 *   answers 409 DUPLICATE_TITLE and links to the existing document. A new
 *   version is only ever created through the explicit versions action.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerDocumentsConsumers } from "../src/modules/documents/consumer.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = "cccccccc-0000-4000-8000-00000000d015";

const tok = (tid: string) => signToken({ sub: ACTOR, tid, roles: ["knowledge_admin"], sid: "sess-d15" }, SECRET, 3600);

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  registerDocumentsConsumers(queue);
});
afterAll(async () => { await app.close(); await sqlClient.end(); });

const drain = () => (queue as unknown as { drain?: () => Promise<void> }).drain?.();

async function create(title: string, tid = TENANT) {
  return app.inject({
    method: "POST", url: "/v1/knowledge/documents",
    headers: { authorization: `Bearer ${tok(tid)}`, "content-type": "application/json" },
    payload: { title, category: "Policy" },
  });
}
const idOf = (r: { json: () => unknown }) => (r.json() as { data?: { id?: string }; id?: string }).data?.id ?? (r.json() as { id?: string }).id!;

async function countRows(tid: string, title: string): Promise<number> {
  return sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${tid}, true)`;
    const rows = await sql`SELECT count(*)::int AS n FROM knowledge.documents WHERE tenant_id = ${tid} AND lower(title) = lower(${title})`;
    return (rows as unknown as Array<{ n: number }>)[0]!.n;
  });
}

describe("owner decision #15 — duplicate document titles", () => {
  it("returns 409 DUPLICATE_TITLE with a link to the existing document", async () => {
    const title = `Leave Policy ${randomUUID().slice(0, 6)}`;
    const first = await create(title);
    expect(first.statusCode).toBe(202);
    const firstId = idOf(first);
    await drain();

    const dup = await create(`  ${title.toUpperCase()}  `);
    expect(dup.statusCode).toBe(409);
    const body = dup.json() as { code: string; existingDocumentId?: string; existingDocumentHref?: string };
    expect(body.code).toBe("DUPLICATE_TITLE");
    expect(body.existingDocumentId).toBe(firstId);
    expect(body.existingDocumentHref).toBe(`/knowledge/documents/${firstId}`);
    await drain();
    expect(await countRows(TENANT, title)).toBe(1);
  });

  it("does not create a version implicitly on a duplicate create", async () => {
    const title = `No Implicit Version ${randomUUID().slice(0, 6)}`;
    const first = await create(title);
    const id = idOf(first);
    await drain();
    expect((await create(title)).statusCode).toBe(409);
    await drain();
    const n = await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      const rows = await sql`SELECT count(*)::int AS n FROM knowledge.document_versions WHERE document_id = ${id}`;
      return (rows as unknown as Array<{ n: number }>)[0]!.n;
    });
    expect(n).toBe(0);
  });

  it("allows the same title in a different tenant", async () => {
    const title = `Shared Title ${randomUUID().slice(0, 6)}`;
    expect((await create(title)).statusCode).toBe(202);
    await drain();
    expect((await create(title, OTHER_TENANT)).statusCode).toBe(202);
  });

  it("two racing creates of one title leave exactly one row (consumer guard + unique index)", async () => {
    const title = `Race ${randomUUID().slice(0, 6)}`;
    const [a, b] = await Promise.all([create(title), create(title)]);
    expect([a.statusCode, b.statusCode].filter((c) => c === 202).length).toBeGreaterThanOrEqual(1);
    await drain();
    expect(await countRows(TENANT, title)).toBe(1);
  });

  it("the database refuses a duplicate (tenant, lower(title)) among live documents", async () => {
    const title = `Index ${randomUUID().slice(0, 6)}`;
    const ins = (t: string) => sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await sql`INSERT INTO knowledge.documents (id, tenant_id, title, created_by, updated_by) VALUES (${randomUUID()}, ${TENANT}, ${t}, ${ACTOR}, ${ACTOR})`;
    });
    await ins(title);
    await expect(ins(title.toUpperCase())).rejects.toThrow(/duplicate key|unique/i);
  });
});
