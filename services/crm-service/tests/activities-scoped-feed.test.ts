/**
 * Scoped activity FEED: GET /v1/crm/activities with no subject.
 * Real HTTP -> route -> Postgres (FORCE RLS). Proves: crm_user sees only what they own / are
 * assigned / records they own; crm_admin sees the tenant; role-denied 403; cross-tenant isolation;
 * the same-tenant-leak guard (one of subjectType/subjectId alone is still a 400); filters,
 * pagination; and that the real response satisfies the shared wire schema the web loader uses.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { crmActivityFeedListSchema } from "@civitasone/schemas/web";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-2222-4000-8000-0000000fd001";
const OTHER = "aaaaaaaa-2222-4000-8000-0000000fd009";
const USER_A = "cccccccc-4444-4000-8000-0000000fd00a";
const USER_B = "cccccccc-4444-4000-8000-0000000fd00b";
const ADMIN = "cccccccc-4444-4000-8000-0000000fd0ad";
const C_A = "22222222-cccc-4000-8000-0000000fd00a"; // contact owned by A
const C_B = "22222222-cccc-4000-8000-0000000fd00b"; // contact owned by B
const D_A = "33333333-cccc-4000-8000-0000000fd00a"; // deal owned by A
const ACC_A = "44444444-cccc-4000-8000-0000000fd00a"; // account owned by A
const id = (n: number) => `55555555-cccc-4000-8000-0000000fd0${String(n).padStart(2, "0")}`;

function hdr(sub: string, roles: string[], tenant = TENANT) {
  return { authorization: `Bearer ${signToken({ sub, tid: tenant, roles, sid: "s" }, SECRET)}`, "x-tenant-id": tenant };
}

async function cleanup() {
  for (const t of [TENANT, OTHER]) {
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${t}, true)`;
      await tx`DELETE FROM crm.activities WHERE tenant_id = ${t}`.catch(() => {});
      await tx`DELETE FROM crm.deals WHERE tenant_id = ${t}`.catch(() => {});
      await tx`DELETE FROM crm.contacts WHERE tenant_id = ${t}`.catch(() => {});
      await tx`DELETE FROM crm.accounts WHERE tenant_id = ${t}`.catch(() => {});
    }).catch(() => {});
  }
}

async function get(url: string, headers: Record<string, string>) {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url, headers });
  await app.close();
  return res;
}
const ids = (res: { json: () => { data: Array<{ id: string }> } }) => res.json().data.map((r) => r.id).sort();

beforeAll(async () => {
  await cleanup();
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    for (const [cid, owner, nm] of [[C_A, USER_A, "Contact Of A"], [C_B, USER_B, "Contact Of B"]] as const) {
      await tx`INSERT INTO crm.contacts (id, tenant_id, name, lead_status, status, version, owner_id, created_at, updated_at, created_by, updated_by)
               VALUES (${cid}, ${TENANT}, ${nm}, 'qualified', 'active', 1, ${owner}, now(), now(), ${ADMIN}, ${ADMIN})`;
    }
    await tx`INSERT INTO crm.accounts (id, tenant_id, name, status, version, owner_id, created_at, updated_at, created_by, updated_by)
             VALUES (${ACC_A}, ${TENANT}, 'Account Of A', 'active', 1, ${USER_A}, now(), now(), ${ADMIN}, ${ADMIN})`;
    await tx`INSERT INTO crm.deals (id, tenant_id, name, owner_id, created_at, updated_at, created_by, updated_by)
             VALUES (${D_A}, ${TENANT}, 'Deal Of A', ${USER_A}, now(), now(), ${ADMIN}, ${ADMIN})`;
    const ins = (n: number, p: { by: string; owner?: string; contact?: string; account?: string; deal?: string; type?: string; status?: string; due?: string; subject: string; text?: string; ago?: number }) =>
      tx`INSERT INTO crm.activities (id, tenant_id, actor_name, text, contact_id, account_id, deal_id, type, subject, status, due_date, owner_id, created_by, updated_by, created_at)
         VALUES (${id(n)}, ${TENANT}, 'Actor', ${p.text ?? "t"}, ${p.contact ?? null}, ${p.account ?? null}, ${p.deal ?? null}, ${p.type ?? "note"}, ${p.subject}, ${p.status ?? "open"}, ${p.due ?? null},
                 ${p.owner ?? null}, ${p.by}, ${p.by}, now() - make_interval(mins => ${p.ago ?? n}))`;
    await ins(1, { by: USER_A, subject: "A created" });                                   // A owns (creator)
    await ins(2, { by: USER_B, owner: USER_A, subject: "assigned to A" });                  // A assigned
    await ins(3, { by: USER_B, contact: C_A, subject: "on A's contact" });                  // A's record
    await ins(4, { by: USER_B, contact: C_B, subject: "on B's contact" });                  // NOT A
    await ins(5, { by: USER_B, subject: "B private", text: "100%_literal" });               // NOT A
    await ins(6, { by: USER_A, subject: "A overdue", type: "task", due: "2020-01-01" });   // A, overdue
    await ins(7, { by: USER_A, owner: USER_B, subject: "A reassigned to B" });              // NOT A anymore
    await ins(8, { by: USER_B, account: ACC_A, subject: "on A's account", status: "completed" }); // A's record
    await ins(9, { by: USER_B, deal: D_A, subject: "on A's deal" });                        // A's record
  });
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${OTHER}, true)`;
    await tx`INSERT INTO crm.activities (id, tenant_id, actor_name, text, type, subject, status, created_by, updated_by)
             VALUES (${id(99)}, ${OTHER}, 'Actor', 't', 'note', 'other tenant', 'open', ${USER_A}, ${USER_A})`;
  });
});

afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("GET /v1/crm/activities (scoped feed)", () => {
  it("crm_user sees only own / assigned / own-record activities (no same-tenant leak)", async () => {
    const res = await get("/v1/crm/activities", hdr(USER_A, ["crm_user"]));
    expect(res.statusCode).toBe(200);
    expect(ids(res)).toEqual([1, 2, 3, 6, 8, 9].map(id).sort());
    expect(res.json().pagination.total).toBe(6);
    const b = await get("/v1/crm/activities", hdr(USER_B, ["crm_user"]));
    expect(ids(b)).toEqual([3, 4, 5, 7, 8, 9].map(id).sort());
  });

  it("crm_admin and super_admin see the whole tenant, never another tenant", async () => {
    for (const role of ["crm_admin", "super_admin"]) {
      const res = await get("/v1/crm/activities?limit=200", hdr(ADMIN, [role]));
      expect(res.statusCode).toBe(200);
      expect(ids(res)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map(id).sort());
      expect(res.json().data.every((r: { tenantId: string }) => r.tenantId === TENANT)).toBe(true);
    }
  });

  it("another tenant's admin sees only its own rows", async () => {
    const res = await get("/v1/crm/activities", hdr(ADMIN, ["crm_admin"], OTHER));
    expect(ids(res)).toEqual([id(99)]);
  });

  it("denies roles outside the CRM set with 403 (feed and timeline)", async () => {
    const res = await get("/v1/crm/activities", hdr(USER_A, ["viewer"]));
    expect(res.statusCode).toBe(403);
    expect((await get("/v1/crm/activities", hdr(USER_A, ["citizen"]))).statusCode).toBe(403);
  });

  it("keeps the leak guard: only one of subjectType/subjectId is a 400, and the timeline still works", async () => {
    expect((await get("/v1/crm/activities?subjectType=contact", hdr(ADMIN, ["crm_admin"]))).statusCode).toBe(400);
    expect((await get(`/v1/crm/activities?subjectId=${C_A}`, hdr(ADMIN, ["crm_admin"]))).statusCode).toBe(400);
    const tl = await get(`/v1/crm/activities?subjectType=contact&subjectId=${C_A}`, hdr(USER_A, ["crm_user"]));
    expect(tl.statusCode).toBe(200);
    expect(ids(tl)).toEqual([id(3)]);
  });

  it("derives overdue, resolves related record and owner fields", async () => {
    const res = await get("/v1/crm/activities?status=overdue", hdr(USER_A, ["crm_user"]));
    expect(res.statusCode).toBe(200);
    const rows = res.json().data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: id(6), status: "overdue", type: "task", ownerId: USER_A, dueDate: "2020-01-01" });
    const all = await get("/v1/crm/activities", hdr(USER_A, ["crm_user"]));
    const onContact = all.json().data.find((r: { id: string }) => r.id === id(3));
    expect(onContact).toMatchObject({ relatedType: "contact", relatedTo: "Contact Of A", status: "open" });
    expect(all.json().data.find((r: { id: string }) => r.id === id(9))).toMatchObject({ relatedType: "deal", relatedTo: "Deal Of A" });
    const onAcc = all.json().data.find((r: { id: string }) => r.id === id(8));
    expect(onAcc).toMatchObject({ relatedType: "other", relatedTo: "Account Of A", status: "completed" });
  });

  it("filters: type, status=open (excludes overdue), mine, ownerId stays inside scope, q is literal", async () => {
    const a = hdr(USER_A, ["crm_user"]);
    expect(ids(await get("/v1/crm/activities?type=task", a))).toEqual([id(6)]);
    expect(ids(await get("/v1/crm/activities?status=open", a))).toEqual([id(1), id(2), id(3), id(9)].sort());
    expect(ids(await get("/v1/crm/activities?status=completed", a))).toEqual([id(8)]);
    expect(ids(await get("/v1/crm/activities?mine=true", a))).toEqual([id(1), id(2), id(6)].sort());
    // A cannot widen scope by asking for B's items
    expect(ids(await get(`/v1/crm/activities?ownerId=${USER_B}`, a))).toEqual([id(3), id(8), id(9)].sort());
    const adm = hdr(ADMIN, ["crm_admin"]);
    expect(ids(await get(`/v1/crm/activities?ownerId=${USER_B}`, adm))).toEqual([3, 4, 5, 7, 8, 9].map(id).sort());
    expect(ids(await get("/v1/crm/activities?relatedType=account", adm))).toEqual([id(8)]);
    expect(ids(await get("/v1/crm/activities?q=100%25_lit", adm))).toEqual([id(5)]);
    expect(ids(await get("/v1/crm/activities?q=%25", adm))).toEqual([id(5)]);
    expect(ids(await get("/v1/crm/activities?dueFrom=2019-01-01&dueTo=2021-01-01", adm))).toEqual([id(6)]);
  });

  it("paginates newest-first with a stable total and hasMore", async () => {
    const adm = hdr(ADMIN, ["crm_admin"]);
    const p1 = (await get("/v1/crm/activities?limit=3&offset=0", adm)).json();
    const p2 = (await get("/v1/crm/activities?limit=3&offset=3", adm)).json();
    const p3 = (await get("/v1/crm/activities?limit=3&offset=6", adm)).json();
    expect(p1.pagination).toMatchObject({ total: 9, hasMore: true, pageSize: 3 });
    expect(p3.pagination).toMatchObject({ total: 9, hasMore: false });
    const seq = [...p1.data, ...p2.data, ...p3.data].map((r: { id: string }) => r.id);
    expect(new Set(seq).size).toBe(9);
    expect(seq[0]).toBe(id(1)); // smallest "mins ago" = newest
  });

  it("rejects bad filter values with 400 and over-large limits", async () => {
    const adm = hdr(ADMIN, ["crm_admin"]);
    expect((await get("/v1/crm/activities?status=bogus", adm)).statusCode).toBe(400);
    expect((await get("/v1/crm/activities?limit=201", adm)).statusCode).toBe(400);
    expect((await get("/v1/crm/activities?ownerId=not-a-uuid", adm)).statusCode).toBe(400);
    // Impossible calendar dates must be a 400, not a Postgres ::date cast 500.
    expect((await get("/v1/crm/activities?dueFrom=2026-02-31", adm)).statusCode).toBe(400);
    expect((await get("/v1/crm/activities?dueTo=2026-13-01", adm)).statusCode).toBe(400);
    expect((await get("/v1/crm/activities?dueFrom=2026-04-31&dueTo=2026-05-01", adm)).statusCode).toBe(400);
    expect((await get("/v1/crm/activities?dueFrom=2024-02-29&dueTo=2024-03-01", adm)).statusCode).toBe(200);
  });

  it("the real response satisfies the shared wire schema the web loader validates against", async () => {
    const res = await get("/v1/crm/activities?limit=200", hdr(ADMIN, ["crm_admin"]));
    expect(crmActivityFeedListSchema.safeParse(res.json()).success).toBe(true);
  });
});
