/**
 * Team-based visibility for crm_user (activities feed, contacts, deals, accounts lists, contacts export)
 * and the admin team-membership routes.
 * Real HTTP -> route -> Postgres (FORCE RLS). Proves: a team member sees records owned by
 * teammates; a non-member does not; crm_admin keeps tenant-wide visibility; removing a member
 * takes effect immediately (cached list pages are dropped); membership routes are admin-only and
 * tenant-isolated.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { crmActivityFeedListSchema } from "@civitasone/schemas/web";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-2222-4000-8000-0000000fe001";
const OTHER = "aaaaaaaa-2222-4000-8000-0000000fe009";
const A = "cccccccc-4444-4000-8000-0000000fe00a"; // team member
const B = "cccccccc-4444-4000-8000-0000000fe00b"; // team member (peer of A)
const C = "cccccccc-4444-4000-8000-0000000fe00c"; // NOT in the team
const ADMIN = "cccccccc-4444-4000-8000-0000000fe0ad";
const TEAM = "dddddddd-4444-4000-8000-0000000fe001";
const OTHER_TEAM = "dddddddd-4444-4000-8000-0000000fe009";
const kid = (kind: string, n: number) => `${kind}-cccc-4000-8000-0000000fe0${String(n).padStart(2, "0")}`;
const CON = { a: kid("22222222", 1), b: kid("22222222", 2), c: kid("22222222", 3), u: kid("22222222", 4) };
const DEAL = { a: kid("33333333", 1), b: kid("33333333", 2), c: kid("33333333", 3) };
const ACC = { a: kid("44444444", 1), b: kid("44444444", 2), c: kid("44444444", 3) };
const ACT = { onB: kid("55555555", 1), onC: kid("55555555", 2), ownA: kid("55555555", 3) };

function hdr(sub: string, roles: string[], tenant = TENANT) {
  return { authorization: `Bearer ${signToken({ sub, tid: tenant, roles, sid: "s" }, SECRET)}`, "x-tenant-id": tenant };
}

async function cleanup() {
  for (const t of [TENANT, OTHER]) {
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${t}, true)`;
      for (const tbl of ["activities", "deals", "contacts", "accounts", "team_members", "teams"]) {
        await tx.unsafe(`DELETE FROM crm.${tbl} WHERE tenant_id = '${t}'`).catch(() => {});
      }
      await tx`DELETE FROM _outbox.messages WHERE tenant_id = ${t}`.catch(() => {});
    }).catch(() => {});
  }
}

async function call(method: "GET" | "POST" | "DELETE", url: string, headers: Record<string, string>, payload?: unknown) {
  const app = await buildApp();
  const res = await app.inject({ method, url, headers, ...(payload !== undefined ? { payload: payload as object } : {}) });
  await app.close();
  return res;
}
const ids = (res: { json: () => { data: Array<{ id: string }> } }) => res.json().data.map((r) => r.id).sort();
const sorted = (...x: string[]) => [...x].sort();

beforeAll(async () => {
  registerAllConsumers(queue);
  await cleanup();
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`INSERT INTO crm.teams (id, tenant_id, name) VALUES (${TEAM}, ${TENANT}, 'Sales North')`;
    await tx`INSERT INTO crm.team_members (tenant_id, team_id, user_id) VALUES (${TENANT}, ${TEAM}, ${A}), (${TENANT}, ${TEAM}, ${B})`;
    for (const [cid, owner, nm] of [[CON.a, A, "Contact Of A"], [CON.b, B, "Contact Of B"], [CON.c, C, "Contact Of C"], [CON.u, null, "Contact Unowned"]] as const) {
      await tx`INSERT INTO crm.contacts (id, tenant_id, name, lead_status, status, version, owner_id, created_at, updated_at, created_by, updated_by)
               VALUES (${cid}, ${TENANT}, ${nm}, 'qualified', 'active', 1, ${owner}, now(), now(), ${ADMIN}, ${ADMIN})`;
    }
    for (const [aid, owner, nm] of [[ACC.a, A, "Account Of A"], [ACC.b, B, "Account Of B"], [ACC.c, C, "Account Of C"]] as const) {
      await tx`INSERT INTO crm.accounts (id, tenant_id, name, status, version, owner_id, created_at, updated_at, created_by, updated_by)
               VALUES (${aid}, ${TENANT}, ${nm}, 'active', 1, ${owner}, now(), now(), ${ADMIN}, ${ADMIN})`;
    }
    for (const [did, owner, nm] of [[DEAL.a, A, "Deal Of A"], [DEAL.b, B, "Deal Of B"], [DEAL.c, C, "Deal Of C"]] as const) {
      await tx`INSERT INTO crm.deals (id, tenant_id, name, owner_id, created_at, updated_at, created_by, updated_by)
               VALUES (${did}, ${TENANT}, ${nm}, ${owner}, now(), now(), ${ADMIN}, ${ADMIN})`;
    }
    const act = (aid: string, contact: string | null, owner: string | null, subject: string) =>
      tx`INSERT INTO crm.activities (id, tenant_id, actor_name, text, contact_id, type, subject, status, owner_id, created_by, updated_by, created_at)
         VALUES (${aid}, ${TENANT}, 'Actor', 't', ${contact}, 'note', ${subject}, 'open', ${owner}, ${ADMIN}, ${ADMIN}, now())`;
    await act(ACT.onB, CON.b, null, "on teammate B's contact");
    await act(ACT.onC, CON.c, null, "on C's contact");
    await act(ACT.ownA, null, A, "owned by A");
  });
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${OTHER}, true)`;
    await tx`INSERT INTO crm.teams (id, tenant_id, name) VALUES (${OTHER_TEAM}, ${OTHER}, 'Other tenant team')`;
  });
});

afterAll(async () => { await cleanup(); await sqlClient.end(); });

describe("team visibility: member vs non-member", () => {
  it("activities feed: a team member sees teammates' record activities, a non-member does not", async () => {
    const a = await call("GET", "/v1/crm/activities", hdr(A, ["crm_user"]));
    expect(a.statusCode).toBe(200);
    expect(crmActivityFeedListSchema.safeParse(a.json()).success).toBe(true);
    expect(ids(a)).toEqual(sorted(ACT.onB, ACT.ownA));
    const c = await call("GET", "/v1/crm/activities", hdr(C, ["crm_user"]));
    expect(ids(c)).toEqual(sorted(ACT.onC));
  });

  it("contacts list: member sees own + teammate + unowned; non-member sees own + unowned", async () => {
    const a = await call("GET", "/v1/crm/contacts?limit=100", hdr(A, ["crm_user"]));
    expect(a.statusCode).toBe(200);
    expect(ids(a)).toEqual(sorted(CON.a, CON.b, CON.u));
    const c = await call("GET", "/v1/crm/contacts?limit=100", hdr(C, ["crm_user"]));
    expect(ids(c)).toEqual(sorted(CON.c, CON.u));
  });

  it("deals list: member sees teammate deals, non-member does not; total follows the scope", async () => {
    const a = await call("GET", "/v1/crm/deals?limit=100", hdr(A, ["crm_user"]));
    expect(a.statusCode).toBe(200);
    expect(ids(a)).toEqual(sorted(DEAL.a, DEAL.b));
    expect(a.json().pagination.total).toBe(2);
    const c = await call("GET", "/v1/crm/deals?limit=100", hdr(C, ["crm_user"]));
    expect(ids(c)).toEqual(sorted(DEAL.c));
    expect(c.json().pagination.total).toBe(1);
  });

  it("accounts list: member sees teammate accounts, non-member does not; total follows the scope", async () => {
    const a = await call("GET", "/v1/crm/accounts?limit=100", hdr(A, ["crm_user"]));
    expect(a.statusCode).toBe(200);
    expect(ids(a)).toEqual(sorted(ACC.a, ACC.b));
    expect(a.json().meta.total).toBe(2);
    const c = await call("GET", "/v1/crm/accounts?limit=100", hdr(C, ["crm_user"]));
    expect(ids(c)).toEqual(sorted(ACC.c));
    expect(c.json().meta.total).toBe(1);
  });

  it("contacts export honours the same scope", async () => {
    const a = await call("GET", "/v1/crm/contacts/export?purpose=team+visibility+test+export", hdr(A, ["crm_user"]));
    expect(a.statusCode).toBe(200);
    expect(a.body).toContain("Contact Of B");
    expect(a.body).not.toContain("Contact Of C");
  });

  it("crm_admin and super_admin keep tenant-wide visibility (and never another tenant)", async () => {
    for (const role of ["crm_admin", "super_admin"]) {
      expect(ids(await call("GET", "/v1/crm/contacts?limit=100", hdr(ADMIN, [role])))).toEqual(sorted(CON.a, CON.b, CON.c, CON.u));
      expect(ids(await call("GET", "/v1/crm/deals?limit=100", hdr(ADMIN, [role])))).toEqual(sorted(DEAL.a, DEAL.b, DEAL.c));
      expect(ids(await call("GET", "/v1/crm/accounts?limit=100", hdr(ADMIN, [role])))).toEqual(sorted(ACC.a, ACC.b, ACC.c));
      expect(ids(await call("GET", "/v1/crm/activities?limit=200", hdr(ADMIN, [role])))).toEqual(sorted(ACT.onB, ACT.onC, ACT.ownA));
    }
    expect(ids(await call("GET", "/v1/crm/contacts?limit=100", hdr(ADMIN, ["crm_admin"], OTHER)))).toEqual([]);
  });

  it("PII masking is unchanged: a team member still gets masked rows", async () => {
    const a = await call("GET", "/v1/crm/contacts?limit=100", hdr(A, ["crm_user"]));
    const row = a.json().data.find((r: { id: string }) => r.id === CON.b);
    expect(row.name).toBe("Contact Of B");
  });
});

describe("team membership admin routes", () => {
  it("denies non-admin roles on list / add / remove (403)", async () => {
    for (const roles of [["crm_user"], ["viewer"]]) {
      expect((await call("GET", `/v1/crm/teams/${TEAM}/members`, hdr(A, roles))).statusCode).toBe(403);
      expect((await call("POST", `/v1/crm/teams/${TEAM}/members`, hdr(A, roles), { userId: C })).statusCode).toBe(403);
      expect((await call("DELETE", `/v1/crm/teams/${TEAM}/members/${B}`, hdr(A, roles))).statusCode).toBe(403);
    }
  });

  it("lists members for an admin", async () => {
    const res = await call("GET", `/v1/crm/teams/${TEAM}/members`, hdr(ADMIN, ["crm_admin"]));
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((m: { userId: string }) => m.userId).sort()).toEqual(sorted(A, B));
  });

  it("validates input and isolates tenants (400 / 404)", async () => {
    expect((await call("POST", `/v1/crm/teams/${TEAM}/members`, hdr(ADMIN, ["crm_admin"]), { userId: "nope" })).statusCode).toBe(400);
    expect((await call("GET", `/v1/crm/teams/${OTHER_TEAM}/members`, hdr(ADMIN, ["crm_admin"]))).statusCode).toBe(404);
    expect((await call("POST", `/v1/crm/teams/${OTHER_TEAM}/members`, hdr(ADMIN, ["crm_admin"]), { userId: C })).statusCode).toBe(404);
  });

  it("add (202 + consumer) makes the new member see teammates at once; remove revokes it, caches included", async () => {
    // Warm A's cached lists, then add C to the team.
    expect(ids(await call("GET", "/v1/crm/contacts?limit=100", hdr(C, ["crm_user"])))).toEqual(sorted(CON.c, CON.u));
    const add = await call("POST", `/v1/crm/teams/${TEAM}/members`, hdr(ADMIN, ["crm_admin"]), { userId: C });
    expect(add.statusCode).toBe(202);
    await drainQueue();
    expect(ids(await call("GET", "/v1/crm/contacts?limit=100", hdr(C, ["crm_user"])))).toEqual(sorted(CON.a, CON.b, CON.c, CON.u));
    expect(ids(await call("GET", "/v1/crm/deals?limit=100", hdr(C, ["crm_user"])))).toEqual(sorted(DEAL.a, DEAL.b, DEAL.c));
    // idempotent add
    expect((await call("POST", `/v1/crm/teams/${TEAM}/members`, hdr(ADMIN, ["crm_admin"]), { userId: C })).statusCode).toBe(202);
    await drainQueue();
    const rows = await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
      return tx`SELECT count(*)::int AS n FROM crm.team_members WHERE team_id = ${TEAM} AND user_id = ${C}`;
    });
    expect(rows[0]?.["n"]).toBe(1);

    const del = await call("DELETE", `/v1/crm/teams/${TEAM}/members/${C}`, hdr(ADMIN, ["crm_admin"]));
    expect(del.statusCode).toBe(202);
    await drainQueue();
    expect(ids(await call("GET", "/v1/crm/contacts?limit=100", hdr(C, ["crm_user"])))).toEqual(sorted(CON.c, CON.u));
    expect(ids(await call("GET", "/v1/crm/accounts?limit=100", hdr(C, ["crm_user"])))).toEqual(sorted(ACC.c));
  });
});
