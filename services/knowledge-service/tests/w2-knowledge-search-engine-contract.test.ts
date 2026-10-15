/**
 * The engine query for a limited user ALWAYS carries the accessLevels filter,
 * and the reindex command populates accessLevel for existing documents.
 * Real DB (FORCE RLS, service role); the search engine is an injected double.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { SearchEngine } from "@civitasone/search";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { setEngine } from "../src/modules/search/repo.js";
import { reindexTenant } from "../src/modules/search/reindex.js";

const SECRET = process.env.JWT_SECRET!;
const TENANT = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID();
const userTok = signToken({ sub: ACTOR, tid: TENANT, roles: ["knowledge_user"], sid: "s" }, SECRET, 3600);
const adminTok = signToken({ sub: ACTOR, tid: TENANT, roles: ["knowledge_admin"], sid: "s" }, SECRET, 3600);
const hdr = (t: string) => ({ authorization: `Bearer ${t}`, "x-tenant-id": TENANT });

function engineDouble() {
  const search = vi.fn().mockResolvedValue({ hits: [], totalHits: 0, processingTimeMs: 1 });
  const bulkIndex = vi.fn().mockResolvedValue(undefined);
  const engine = { initialize: vi.fn(), index: vi.fn(), bulkIndex, search, remove: vi.fn(), removeAll: vi.fn(), healthy: vi.fn(), close: vi.fn() };
  return { engine: engine as unknown as SearchEngine, search, bulkIndex };
}

let app: FastifyInstance;
beforeAll(async () => { app = await buildApp(); });
afterAll(async () => { setEngine(null); await app.close(); await sqlClient.end(); });

describe("engine query carries the clearance filter", () => {
  it("every GET /search by a knowledge_user (any params) sends accessLevels=[internal,public]; an admin sends none", async () => {
    const { engine, search } = engineDouble();
    setEngine(engine);
    const urls = [
      "/v1/knowledge/search?q=a",
      "/v1/knowledge/search?q=a&category=policy",
      "/v1/knowledge/search?q=a&tags=x,y",
      "/v1/knowledge/search?q=a&limit=5&offset=10",
    ];
    for (const url of urls) {
      expect((await app.inject({ method: "GET", url, headers: hdr(userTok) })).statusCode).toBe(200);
    }
    expect(search).toHaveBeenCalledTimes(urls.length);
    for (const call of search.mock.calls) {
      expect((call[0] as { accessLevels?: string[] }).accessLevels?.slice().sort()).toEqual(["internal", "public"]);
    }
    search.mockClear();
    await app.inject({ method: "GET", url: urls[0]!, headers: hdr(adminTok) });
    expect((search.mock.calls[0]![0] as { accessLevels?: string[] }).accessLevels).toBeUndefined();
  });
});

describe("reindexTenant populates accessLevel", () => {
  it("indexes each document with its level, unknown documents as restricted, only this tenant, across batches", async () => {
    const levels = ["public", "internal", "restricted", "confidential"];
    const expected: Record<string, string> = {};
    await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      for (const level of levels) {
        const docId = randomUUID(); const idxId = randomUUID();
        expected[idxId] = level;
        await sql`INSERT INTO knowledge.documents (id, tenant_id, title, category, status, access_level, created_by, updated_by)
                  VALUES (${docId}, ${TENANT}, ${`t ${level}`}, 'c', 'approved', ${level}, ${ACTOR}, ${ACTOR})`;
        await sql`INSERT INTO knowledge.search_index (id, tenant_id, document_id, title, content, tags) VALUES (${idxId}, ${TENANT}, ${docId}, ${`t ${level}`}, 'body', ARRAY[]::text[])`;
      }
      const orphan = randomUUID();
      expected[orphan] = "restricted";
      await sql`INSERT INTO knowledge.search_index (id, tenant_id, document_id, title, content, tags) VALUES (${orphan}, ${TENANT}, ${randomUUID()}, 'orphan', 'b', ARRAY[]::text[])`;
    });
    await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${OTHER}, true)`;
      await sql`INSERT INTO knowledge.search_index (id, tenant_id, document_id, title, content, tags) VALUES (${randomUUID()}, ${OTHER}, ${randomUUID()}, 'other tenant', 'b', ARRAY[]::text[])`;
    });

    const { engine, bulkIndex } = engineDouble();
    const n = await reindexTenant(engine, TENANT, 2); // 5 rows, batches of 2
    expect(n).toBe(5);
    expect(bulkIndex.mock.calls.length).toBe(3);
    const sent = bulkIndex.mock.calls.flatMap((c) => c[0] as Array<{ id: string; accessLevel: string; tenantId: string }>);
    expect(sent).toHaveLength(5);
    for (const d of sent) {
      expect(d.tenantId).toBe(TENANT);
      expect(d.accessLevel).toBe(expected[d.id]);
    }
  });
});
