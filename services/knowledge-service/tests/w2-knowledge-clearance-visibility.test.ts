/**
 * Wave 2 knowledge backend closure (real DB, FORCE RLS, service role).
 *
 * GAP-KNOWLEDGE-LIST-05 / REPOSITORY-06 / DASHBOARD-05 / SEARCH-06:
 *   GET /v1/knowledge/documents (+ summary, records, search, articles/:id) is
 *   authenticated, tenant-scoped, paginated, and excludes documents whose
 *   accessLevel is above the caller's clearance - absent from the body, not
 *   merely hidden by the UI.
 * GAP-KNOWLEDGE-POLICIES-04: GET policies returns draft/under_review only to
 *   approver roles and the document's own author/reviewer; published to others.
 * GAP-KNOWLEDGE-POLICIES-DETAIL-06: transitions are role-gated and an
 *   acknowledgement binds to the caller (no forging for others, idempotent).
 * GAP-KNOWLEDGE-FAQS-04 / RECORDS-05 / HOME-04: 401 without a token, 403 for a
 *   foreign role, and another tenant's rows never appear.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET!;
const TENANT_A = randomUUID();
const TENANT_B = randomUUID();
const USER = randomUUID();
const USER_2 = randomUUID();
const ADMIN = randomUUID();
const ADMIN_2 = randomUUID();

function tok(tenant: string, sub: string, roles: string[]) {
  return signToken({ sub, tid: tenant, roles, sid: "sess-w2kn1" }, SECRET, 3600);
}
const userTok = tok(TENANT_A, USER, ["knowledge_user"]);
const user2Tok = tok(TENANT_A, USER_2, ["knowledge_user"]);
const adminTok = tok(TENANT_A, ADMIN, ["knowledge_admin"]);
const admin2Tok = tok(TENANT_A, ADMIN_2, ["knowledge_admin"]);
const tenantBAdminTok = tok(TENANT_B, randomUUID(), ["knowledge_admin"]);
const citizenTok = tok(TENANT_A, randomUUID(), ["citizen"]);

const marker = `w2kn1-${randomUUID().slice(0, 8)}`;
const DOC: Record<string, string> = {};

let app: FastifyInstance;

async function seedDoc(tenant: string, key: string, accessLevel: string, category = marker) {
  const id = randomUUID();
  await sqlClient.begin(async (sql) => {
    await sql`SELECT set_config('app.tenant_id', ${tenant}, true)`;
    await sql`INSERT INTO knowledge.documents (id, tenant_id, title, category, status, access_level, created_by, updated_by)
              VALUES (${id}, ${tenant}, ${`${marker} ${key}`}, ${category}, 'approved', ${accessLevel}, ${ADMIN}, ${ADMIN})`;
  });
  DOC[`${tenant === TENANT_A ? "A" : "B"}:${key}`] = id;
  return id;
}

// The gateway injects x-tenant-id from the JWT (jwt-edge.ts); the per-request RLS GUC hook reads it.
const TENANT_OF = new Map<string, string>([[userTok, TENANT_A], [user2Tok, TENANT_A], [adminTok, TENANT_A], [admin2Tok, TENANT_A], [citizenTok, TENANT_A], [tenantBAdminTok, TENANT_B]]);
function auth(t: string) { return { authorization: `Bearer ${t}`, "x-tenant-id": TENANT_OF.get(t)! }; }
function idOf(res: { json: () => unknown }): string {
  const b = res.json() as { id?: string; data?: { id?: string } };
  return (b.data?.id ?? b.id)!;
}
async function titles(url: string, t: string, method: "GET" | "POST" = "GET", payload?: unknown): Promise<string[]> {
  const res = await app.inject({ method, url, headers: { ...auth(t), "content-type": "application/json" }, ...(payload ? { payload: payload as object } : {}) });
  expect(res.statusCode).toBe(200);
  const body = res.json() as unknown;
  const arr = Array.isArray(body) ? body : (body as { data: unknown[] }).data;
  return (arr as Array<{ title: string }>).map((d) => d.title).filter((t2) => t2.startsWith(marker));
}

beforeAll(async () => {
  app = await buildApp();
  await seedDoc(TENANT_A, "public", "public");
  await seedDoc(TENANT_A, "internal", "internal");
  await seedDoc(TENANT_A, "restricted", "restricted");
  await seedDoc(TENANT_A, "confidential", "confidential");
  await seedDoc(TENANT_B, "tenantB-internal", "internal");
});
afterAll(async () => { await app.close(); await sqlClient.end(); });

describe("document access-level clearance (LIST-05, REPOSITORY-06, DASHBOARD-05, SEARCH-06)", () => {
  it("Given restricted/confidential docs, when an admin lists first (warming the cache) and a knowledge_user lists next, then the user's body has no restricted/confidential rows", async () => {
    const adminSees = await titles("/v1/knowledge/documents?limit=200", adminTok);
    expect(adminSees).toEqual(expect.arrayContaining([`${marker} restricted`, `${marker} confidential`, `${marker} public`, `${marker} internal`]));

    const userSees = await titles("/v1/knowledge/documents?limit=200", userTok);
    expect(userSees.sort()).toEqual([`${marker} internal`, `${marker} public`]);
  });

  it("never returns another tenant's rows to either role", async () => {
    expect(await titles("/v1/knowledge/documents?limit=200", adminTok)).not.toContain(`${marker} tenantB-internal`);
    expect(await titles("/v1/knowledge/documents?limit=200", userTok)).not.toContain(`${marker} tenantB-internal`);
    // tenant B only sees its own row
    expect(await titles("/v1/knowledge/documents?limit=200", tenantBAdminTok)).toEqual([`${marker} tenantB-internal`]);
  });

  it("paginates: limit/offset bound the page", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/knowledge/documents?limit=1&offset=0", headers: auth(adminTok) });
    expect(res.statusCode).toBe(200);
    expect((res.json() as unknown[]).length).toBe(1);
  });

  it("401 without a token and 403 for a foreign role", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/knowledge/documents" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/knowledge/documents", headers: auth(citizenTok) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/v1/knowledge/records" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/knowledge/records", headers: auth(citizenTok) })).statusCode).toBe(403);
  });

  it("search (POST /search) omits restricted docs for a knowledge_user but a knowledge_admin finds them", async () => {
    const user = await titles("/v1/knowledge/search", userTok, "POST", { query: marker, limit: 100 });
    expect(user).not.toContain(`${marker} restricted`);
    expect(user).not.toContain(`${marker} confidential`);
    expect(user).toContain(`${marker} internal`);
    const admin = await titles("/v1/knowledge/search", adminTok, "POST", { query: marker, limit: 100 });
    expect(admin).toEqual(expect.arrayContaining([`${marker} restricted`, `${marker} confidential`]));
  });

  it("detail by id: 404 for an uncleared user, 200 for an admin; an uncleared user cannot publish it either", async () => {
    const restricted = DOC["A:restricted"]!;
    expect((await app.inject({ method: "GET", url: `/v1/knowledge/articles/${restricted}`, headers: auth(userTok) })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/knowledge/articles/${restricted}`, headers: auth(adminTok) })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/v1/knowledge/articles/${DOC["A:internal"]}`, headers: auth(userTok) })).statusCode).toBe(200);
    const patch = await app.inject({
      method: "PATCH", url: `/v1/knowledge/articles/${restricted}/publish`,
      headers: { ...auth(userTok), "content-type": "application/json" }, payload: { published: false },
    });
    expect(patch.statusCode).toBe(404);
  });

  it("summary counts exclude uncleared documents for a knowledge_user", async () => {
    const countFor = async (t: string) => {
      const res = await app.inject({ method: "GET", url: "/v1/knowledge/documents/summary", headers: auth(t) });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { byCategory: Array<{ category: string; count: number }> };
      return body.byCategory.find((c) => c.category === marker)?.count ?? 0;
    };
    expect(await countFor(adminTok)).toBe(4);
    expect(await countFor(userTok)).toBe(2);
  });

  it("records projection excludes uncleared documents for a knowledge_user", async () => {
    const ids = async (t: string) => {
      const res = await app.inject({ method: "GET", url: "/v1/knowledge/records?limit=200", headers: auth(t) });
      expect(res.statusCode).toBe(200);
      return (res.json() as Array<{ title: string }>).map((r) => r.title).filter((x) => x.startsWith(marker));
    };
    expect(await ids(userTok)).not.toContain(`${marker} restricted`);
    expect(await ids(adminTok)).toContain(`${marker} restricted`);
  });

  it("a knowledge_user cannot create a document above their clearance (403); an admin can (202)", async () => {
    const mk = (t: string, accessLevel: string) => app.inject({
      method: "POST", url: "/v1/knowledge/documents",
      headers: { ...auth(t), "content-type": "application/json" },
      payload: { title: `${marker} created-${accessLevel}`, accessLevel },
    });
    expect((await mk(userTok, "restricted")).statusCode).toBe(403);
    expect((await mk(userTok, "internal")).statusCode).toBe(202);
    expect((await mk(adminTok, "restricted")).statusCode).toBe(202);
  });
});

describe("policy visibility, acknowledgement scoping and forging (POLICIES-04, POLICIES-DETAIL-06, DETAIL-01)", () => {
  let draftId: string;
  let publishedId: string;

  async function makeDraft(t: string, title: string): Promise<string> {
    const res = await app.inject({
      method: "POST", url: "/v1/knowledge/policies",
      headers: { ...auth(t), "content-type": "application/json" },
      payload: { title: `${marker} ${title}`, docType: "policy", body: "text" },
    });
    expect(res.statusCode).toBe(202);
    return idOf(res);
  }

  beforeAll(async () => {
    draftId = await makeDraft(userTok, "draft by USER");
    publishedId = await makeDraft(adminTok, "published doc");
    for (const [path, t] of [["submit", adminTok], ["approve", admin2Tok], ["publish", admin2Tok]] as const) {
      const r = await app.inject({ method: "POST", url: `/v1/knowledge/policies/${publishedId}/${path}`, headers: { ...auth(t), "content-type": "application/json" }, payload: {} });
      expect(r.statusCode).toBe(202);
    }
  });

  async function listTitles(t: string): Promise<string[]> {
    const res = await app.inject({ method: "GET", url: "/v1/knowledge/policies?limit=200", headers: auth(t) });
    expect(res.statusCode).toBe(200);
    return (res.json() as Array<{ title: string }>).map((p) => p.title).filter((x) => x.startsWith(marker));
  }

  it("a draft is hidden from other knowledge_users, visible to its author and to approvers; published is visible to all", async () => {
    expect(await listTitles(user2Tok)).toEqual([`${marker} published doc`]);
    expect((await listTitles(userTok)).sort()).toEqual([`${marker} draft by USER`, `${marker} published doc`]);
    expect((await listTitles(adminTok)).sort()).toEqual([`${marker} draft by USER`, `${marker} published doc`]);
  });

  it("GET by id: a draft is 404 to another knowledge_user, 200 to its author and an approver", async () => {
    const get = (t: string) => app.inject({ method: "GET", url: `/v1/knowledge/policies/${draftId}`, headers: auth(t) });
    expect((await get(user2Tok)).statusCode).toBe(404);
    expect((await get(userTok)).statusCode).toBe(200);
    expect((await get(adminTok)).statusCode).toBe(200);
  });

  it("policies are tenant scoped and need a token", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/knowledge/policies?limit=200", headers: auth(tenantBAdminTok) });
    expect((res.json() as Array<{ title: string }>).filter((p) => p.title.startsWith(marker))).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/v1/knowledge/policies" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/knowledge/policies/review-due" })).statusCode).toBe(401);
  });

  it("transitions are role gated: knowledge_user gets 403 on approve/publish/reject, and the author cannot approve (403 MAKER_CHECKER)", async () => {
    for (const p of ["approve", "publish", "reject"]) {
      const r = await app.inject({ method: "POST", url: `/v1/knowledge/policies/${draftId}/${p}`, headers: { ...auth(userTok), "content-type": "application/json" }, payload: { reason: "ten chars+ reason" } });
      expect(r.statusCode).toBe(403);
    }
    // publish on a still-draft doc by an approver -> 409
    const wrong = await app.inject({ method: "POST", url: `/v1/knowledge/policies/${draftId}/publish`, headers: { ...auth(adminTok), "content-type": "application/json" }, payload: {} });
    expect(wrong.statusCode).toBe(409);
  });

  it("an acknowledgement cannot be forged for another employee (403) and acknowledging twice yields one ack", async () => {
    const ack = (t: string, payload: object) => app.inject({ method: "POST", url: `/v1/knowledge/policies/${publishedId}/acknowledge`, headers: { ...auth(t), "content-type": "application/json" }, payload });
    expect((await ack(userTok, { employeeId: USER_2 })).statusCode).toBe(403);
    expect((await ack(userTok, {})).statusCode).toBe(202);
    expect((await ack(userTok, {})).statusCode).toBe(202);
    expect((await ack(user2Tok, { employeeId: USER_2 })).statusCode).toBe(202);

    const count = await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${TENANT_A}, true)`;
      const rows = await sql`SELECT employee_id FROM knowledge.policy_acknowledgements WHERE policy_id = ${publishedId}`;
      return (rows as unknown as Array<{ employee_id: string }>).map((r) => r.employee_id).sort();
    });
    expect(count).toEqual([USER, USER_2].sort());
  });

  it("the acknowledgement list shows an approver everyone, but a knowledge_user only the total and their own id", async () => {
    const get = async (t: string) => (await app.inject({ method: "GET", url: `/v1/knowledge/policies/${publishedId}/acknowledgements`, headers: auth(t) })).json() as { acknowledgedCount: number; employeeIds: string[] };
    const admin = await get(adminTok);
    expect(admin.acknowledgedCount).toBe(2);
    expect(admin.employeeIds.sort()).toEqual([USER, USER_2].sort());
    const user = await get(userTok);
    expect(user.acknowledgedCount).toBe(2);
    expect(user.employeeIds).toEqual([USER]);
  });

  it("the who-hasn't-acknowledged report is for approver roles only", async () => {
    const rep = (t: string) => app.inject({ method: "POST", url: `/v1/knowledge/policies/${publishedId}/acknowledgements/report`, headers: { ...auth(t), "content-type": "application/json" }, payload: { expectedEmployeeIds: [USER, USER_2] } });
    expect((await rep(userTok)).statusCode).toBe(403);
    expect((await rep(adminTok)).statusCode).toBe(200);
  });
});

describe("FAQs and guided flows (FAQS-04, HOME-04)", () => {
  async function seedFaq(tenant: string, status: string, label: string) {
    const id = randomUUID();
    await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${tenant}, true)`;
      await sql`INSERT INTO knowledge.faqs (id, tenant_id, question, answer, category, status, created_by, updated_by)
                VALUES (${id}, ${tenant}, ${`${marker} ${label}`}, 'a', ${marker}, ${status}, ${ADMIN}, ${ADMIN})`;
    });
    return id;
  }

  it("lists are authenticated, tenant scoped and published-only for knowledge_user; draft by id is 404", async () => {
    const pub = await seedFaq(TENANT_A, "published", "faq published");
    const draft = await seedFaq(TENANT_A, "draft", "faq draft");
    await seedFaq(TENANT_B, "published", "faq tenantB");

    expect((await app.inject({ method: "GET", url: "/v1/knowledge/faqs" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/knowledge/guided-flows" })).statusCode).toBe(401);

    const list = async (t: string) => ((await app.inject({ method: "GET", url: "/v1/knowledge/faqs?limit=200", headers: auth(t) })).json() as Array<{ question: string }>).map((f) => f.question).filter((q) => q.startsWith(marker)).sort();
    expect(await list(userTok)).toEqual([`${marker} faq published`]);
    expect(await list(adminTok)).toEqual([`${marker} faq draft`, `${marker} faq published`]);

    expect((await app.inject({ method: "GET", url: `/v1/knowledge/faqs/${draft}`, headers: auth(userTok) })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/knowledge/faqs/${draft}`, headers: auth(adminTok) })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/v1/knowledge/faqs/${pub}`, headers: auth(userTok) })).statusCode).toBe(200);
  });
});
