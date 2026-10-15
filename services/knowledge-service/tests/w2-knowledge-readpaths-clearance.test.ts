/**
 * Wave 2 knowledge: the remaining document read paths apply the same
 * access-level clearance as GET /documents (real DB, FORCE RLS, service role).
 *
 *  - GET /v1/knowledge/search                         (search_index)
 *  - /v1/knowledge/documents/:id/versions            (list, get, create, restore)
 *  - POST /v1/knowledge/ai/search and /ai/summarize  (retrieval query itself is filtered)
 *
 * A knowledge_user must not obtain a restricted/confidential document through
 * any of them; a knowledge_admin can.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET!;
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();
const marker = `w2rp-${randomUUID().slice(0, 8)}`;

function tok(roles: string[], tenant = TENANT) {
  return signToken({ sub: ACTOR, tid: tenant, roles, sid: "sess-w2rp" }, SECRET, 3600);
}
const userTok = tok(["knowledge_user"]);
const adminTok = tok(["knowledge_admin"]);
function hdr(t: string, tenant = TENANT) {
  return { authorization: `Bearer ${t}`, "x-tenant-id": tenant, "content-type": "application/json" };
}

const LEVELS = ["public", "internal", "restricted", "confidential"] as const;
const DOC: Record<string, string> = {};
const VERSION: Record<string, string> = {};

const sendPromptMock = vi.fn();
const getObjectMock = vi.fn();
let app: FastifyInstance;
let sqlClient: { begin: <T>(fn: (sql: any) => Promise<T>) => Promise<T>; end: () => Promise<void> };

beforeAll(async () => {
  vi.stubEnv("FEATURE_AI_ASSISTANT_ENABLED", "true");
  vi.stubEnv("ANTHROPIC_API_KEY", "x-not-a-secret");
  vi.resetModules();
  vi.doMock("../src/modules/ai/adapter.js", async (orig) => ({
    ...(await orig<typeof import("../src/modules/ai/adapter.js")>()),
    isEnabled: () => true,
    sendPrompt: (...a: unknown[]) => sendPromptMock(...a),
  }));
  vi.doMock("@civitasone/storage", async (orig) => ({
    ...(await orig<typeof import("@civitasone/storage")>()),
    getObject: (...a: unknown[]) => getObjectMock(...a),
  }));
  const { buildApp } = await import("../src/app.js");
  ({ sqlClient } = (await import("../src/shared/db.js")) as unknown as { sqlClient: typeof sqlClient });
  app = await buildApp();

  for (const level of LEVELS) {
    const id = randomUUID();
    DOC[level] = id;
    const versionId = randomUUID();
    VERSION[level] = versionId;
    await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      await sql`INSERT INTO knowledge.documents (id, tenant_id, title, category, status, access_level, created_by, updated_by)
                VALUES (${id}, ${TENANT}, ${`${marker} ${level}`}, ${marker}, 'approved', ${level}, ${ACTOR}, ${ACTOR})`;
      await sql`INSERT INTO knowledge.search_index (id, tenant_id, document_id, title, content, tags)
                VALUES (${randomUUID()}, ${TENANT}, ${id}, ${`${marker} ${level}`}, ${`${marker} body of ${level}`}, ARRAY[]::text[])`;
      await sql`INSERT INTO knowledge.document_versions (id, tenant_id, document_id, version_no, s3_key, created_by, updated_by)
                VALUES (${versionId}, ${TENANT}, ${id}, 1, ${`k/${level}`}, ${ACTOR}, ${ACTOR})`;
    });
  }
  // an index row in another tenant must never surface
  const otherDoc = randomUUID();
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${OTHER_TENANT}, true)`;
    await sql`INSERT INTO knowledge.documents (id, tenant_id, title, category, status, access_level, created_by, updated_by)
              VALUES (${otherDoc}, ${OTHER_TENANT}, ${`${marker} other-tenant`}, ${marker}, 'approved', 'public', ${ACTOR}, ${ACTOR})`;
    await sql`INSERT INTO knowledge.search_index (id, tenant_id, document_id, title, content, tags)
              VALUES (${randomUUID()}, ${OTHER_TENANT}, ${otherDoc}, ${`${marker} other-tenant`}, ${marker}, ARRAY[]::text[])`;
  });
});
afterAll(async () => {
  await app.close();
  await sqlClient.end();
  vi.unstubAllEnvs();
  vi.doUnmock("../src/modules/ai/adapter.js");
  vi.doUnmock("@civitasone/storage");
});

describe("GET /v1/knowledge/search (search_index)", () => {
  const titles = async (t: string) => {
    const res = await app.inject({ method: "GET", url: `/v1/knowledge/search?q=${marker}&limit=50`, headers: hdr(t) });
    expect(res.statusCode).toBe(200);
    return (res.json() as Array<{ title: string }>).map((r) => r.title).sort();
  };

  it("a knowledge_user gets public/internal only, never restricted/confidential, never another tenant", async () => {
    expect(await titles(userTok)).toEqual([`${marker} internal`, `${marker} public`]);
  });

  it("a knowledge_admin can find the restricted and confidential documents", async () => {
    expect(await titles(adminTok)).toEqual(expect.arrayContaining([`${marker} restricted`, `${marker} confidential`]));
  });

  it("401 without a token", async () => {
    expect((await app.inject({ method: "GET", url: `/v1/knowledge/search?q=${marker}` })).statusCode).toBe(401);
  });
});

describe("/v1/knowledge/documents/:id/versions", () => {
  const get = (t: string, level: string, suffix = "") =>
    app.inject({ method: "GET", url: `/v1/knowledge/documents/${DOC[level]}/versions${suffix}`, headers: hdr(t) });

  it("list: a knowledge_user gets 404 for restricted/confidential and 200 for internal; an admin gets 200 for all", async () => {
    for (const level of ["restricted", "confidential"]) {
      expect((await get(userTok, level)).statusCode).toBe(404);
      const admin = await get(adminTok, level);
      expect(admin.statusCode).toBe(200);
      expect((admin.json() as unknown[]).length).toBe(1);
    }
    expect((await get(userTok, "internal")).statusCode).toBe(200);
  });

  it("get: a version of an uncleared document is 404 for a knowledge_user and 200 for an admin", async () => {
    for (const level of ["restricted", "confidential"]) {
      expect((await get(userTok, level, `/${VERSION[level]}`)).statusCode).toBe(404);
      expect((await get(adminTok, level, `/${VERSION[level]}`)).statusCode).toBe(200);
    }
    expect((await get(userTok, "public", `/${VERSION["public"]}`)).statusCode).toBe(200);
  });

  it("the cached list for an admin is not served to a knowledge_user afterwards", async () => {
    await get(adminTok, "restricted"); // warms the cache
    expect((await get(userTok, "restricted")).statusCode).toBe(404);
  });

  it("create / restore are 404 for an uncleared document; a non-uuid document id is 404, not 500", async () => {
    const post = (url: string, payload: object) => app.inject({ method: "POST", url, headers: hdr(userTok), payload });
    expect((await post(`/v1/knowledge/documents/${DOC["restricted"]}/versions`, { s3Key: "k/x", changeNote: "n" })).statusCode).toBe(404);
    expect((await post(`/v1/knowledge/documents/${DOC["restricted"]}/versions/${VERSION["restricted"]}/restore`, {})).statusCode).toBe(404);
    expect((await get(userTok, "restricted").then(() => app.inject({ method: "GET", url: "/v1/knowledge/documents/not-a-uuid/versions", headers: hdr(userTok) }))).statusCode).toBe(404);
  });
});

describe("POST /v1/knowledge/ai/summarize", () => {
  const summarize = (t: string, level: string) =>
    app.inject({ method: "POST", url: "/v1/knowledge/ai/summarize", headers: hdr(t), payload: { documentId: DOC[level] } });

  it("a knowledge_user cannot summarize a restricted/confidential document: 404 and the content is never fetched or sent to the model", async () => {
    sendPromptMock.mockReset();
    getObjectMock.mockReset();
    for (const level of ["restricted", "confidential"]) {
      expect((await summarize(userTok, level)).statusCode).toBe(404);
    }
    expect(getObjectMock).not.toHaveBeenCalled();
    expect(sendPromptMock).not.toHaveBeenCalled();
  });

  it("a knowledge_user can summarize an internal one, and an admin can summarize a restricted one", async () => {
    sendPromptMock.mockReset().mockResolvedValue("a summary");
    getObjectMock.mockReset().mockResolvedValue(Buffer.from("plain body"));
    expect((await summarize(userTok, "internal")).statusCode).toBe(200);
    const admin = await summarize(adminTok, "restricted");
    expect(admin.statusCode).toBe(200);
    expect(sendPromptMock).toHaveBeenCalledTimes(2);
  });
});

describe("POST /v1/knowledge/ai/search", () => {
  const aiSearch = async (t: string) => {
    sendPromptMock.mockReset().mockResolvedValue(JSON.stringify({ module: null, entityType: null, keywords: [marker], filters: {} }));
    const res = await app.inject({ method: "POST", url: "/v1/knowledge/ai/search", headers: hdr(t), payload: { query: `find ${marker}` } });
    expect(res.statusCode).toBe(200);
    return (res.json() as { data: { results: Array<{ title: string }> } }).data.results.map((r) => r.title).sort();
  };

  it("a knowledge_user's AI search retrieves and cites public/internal only", async () => {
    expect(await aiSearch(userTok)).toEqual([`${marker} internal`, `${marker} public`]);
  });

  it("a knowledge_admin can retrieve the restricted and confidential documents", async () => {
    expect(await aiSearch(adminTok)).toEqual(expect.arrayContaining([`${marker} restricted`, `${marker} confidential`]));
  });

  it("the clearance is part of the engine query itself (accessLevels), and absent for an admin", async () => {
    const { setEngine } = await import("../src/modules/ai/nl-search.js");
    const search = vi.fn().mockResolvedValue({ hits: [], totalHits: 0, processingTimeMs: 1 });
    setEngine({ initialize: vi.fn(), index: vi.fn(), bulkIndex: vi.fn(), search, remove: vi.fn(), removeAll: vi.fn(), healthy: vi.fn(), close: vi.fn() } as never);
    try {
      for (const t of [userTok, adminTok]) {
        sendPromptMock.mockReset().mockResolvedValue(JSON.stringify({ module: null, entityType: null, keywords: [marker], filters: {} }));
        const res = await app.inject({ method: "POST", url: "/v1/knowledge/ai/search", headers: hdr(t), payload: { query: `find ${marker}` } });
        expect(res.statusCode).toBe(200);
      }
      expect((search.mock.calls[0]![0] as { accessLevels?: string[] }).accessLevels?.slice().sort()).toEqual(["internal", "public"]);
      expect((search.mock.calls[1]![0] as { accessLevels?: string[] }).accessLevels).toBeUndefined();
    } finally {
      setEngine(null);
    }
  });
});
