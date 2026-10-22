/**
 * GAP-CRM-ACCOUNTS-DETAIL-01 -- GET /v1/crm/accounts/:id and the server-side account
 * search the pickers use.
 *
 * The detail page used to resolve an account by scanning the list endpoint, which is
 * capped at 200 rows, so a valid deep link to an account beyond the cap rendered
 * "not found". These DB-backed HTTP tests assert:
 *   - the by-id route returns an account regardless of where it would fall in the list,
 *     scoped to the caller's tenant, active accounts only, with its sub-tree size;
 *   - an unknown / other-tenant / merged-away id is a 404 (never someone else's row);
 *   - GET /v1/crm/accounts?search= and ?excludeSubtreeOf= narrow on the server (LIKE
 *     metacharacters are literal, the excluded account's whole subtree is hidden).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const ACTOR = randomUUID();

function headers(roles: string[], tenantId = TENANT): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-ad1" }, SECRET)}`,
    "x-tenant-id": tenantId,
  };
}

async function get(url: string, roles = ["crm_user"], tenantId = TENANT) {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url, headers: headers(roles, tenantId) });
  await app.close();
  return res;
}

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}

async function insertAccount(
  tenantId: string,
  name: string,
  opts: { parentId?: string | null; status?: string; industry?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await scoped(tenantId, (tx) => tx`
    INSERT INTO crm.accounts (id, tenant_id, name, industry, parent_id, status, created_by, updated_by)
    VALUES (${id}, ${tenantId}, ${name}, ${opts.industry ?? null}, ${opts.parentId ?? null}, ${opts.status ?? "active"}, ${ACTOR}, ${ACTOR})`);
  return id;
}

async function cleanup(): Promise<void> {
  for (const t of [TENANT, OTHER_TENANT]) {
    await scoped(t, (tx) => tx`DELETE FROM crm.contacts WHERE tenant_id = ${t}`).catch(() => {});
    await scoped(t, (tx) => tx`DELETE FROM crm.accounts WHERE tenant_id = ${t}`).catch(() => {});
  }
}

let root = "";
let child = "";
let grandchild = "";
let unrelated = "";
let late = "";

beforeAll(async () => {
  await cleanup();
  root = await insertAccount(TENANT, "Alpha Ministry", { industry: "Energy" });
  child = await insertAccount(TENANT, "Alpha Wing", { parentId: root });
  grandchild = await insertAccount(TENANT, "Alpha Desk", { parentId: child });
  unrelated = await insertAccount(TENANT, "Beta Board");
  // An inactive (merged-away) child must not count towards the sub-tree size.
  await insertAccount(TENANT, "Alpha Retired", { parentId: root, status: "inactive" });
  // 205 more accounts that sort AFTER the ones above: the last of them sits beyond the
  // 200-row cap of the list endpoint, which is exactly the old "not found" case.
  await scoped(TENANT, (tx) => tx`
    INSERT INTO crm.accounts (tenant_id, name, created_by, updated_by)
    SELECT ${TENANT}, 'Zeta Cap ' || lpad(g::text, 3, '0'), ${ACTOR}, ${ACTOR} FROM generate_series(1, 205) g`);
  late = (await scoped(TENANT, (tx) => tx<Array<{ id: string }>>`
    SELECT id FROM crm.accounts WHERE tenant_id = ${TENANT} AND name = 'Zeta Cap 205'`))[0]!.id;
});

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("GET /v1/crm/accounts/:id (GAP-CRM-ACCOUNTS-DETAIL-01)", () => {
  it("returns an account that the 200-row list page cannot reach", async () => {
    const list = await get("/v1/crm/accounts?limit=200");
    expect(list.statusCode).toBe(200);
    const ids = (list.json().data as Array<{ id: string }>).map((a) => a.id);
    expect(ids).toHaveLength(200);
    expect(ids).not.toContain(late); // beyond the cap...

    const res = await get(`/v1/crm/accounts/${late}`);
    expect(res.statusCode).toBe(200); // ...but resolvable by id.
    expect(res.json().data).toMatchObject({ id: late, name: "Zeta Cap 205", parentId: null, contactCount: 0 });
  });

  it("includes the number of ACTIVE sub-accounts below the account", async () => {
    const r = (await get(`/v1/crm/accounts/${root}`)).json().data;
    expect(r).toMatchObject({ id: root, name: "Alpha Ministry", industry: "Energy", descendantCount: 2 }); // wing + desk, not the retired one
    const c = (await get(`/v1/crm/accounts/${child}`)).json().data;
    expect(c).toMatchObject({ parentId: root, descendantCount: 1 });
    const g = (await get(`/v1/crm/accounts/${grandchild}`)).json().data;
    expect(g.descendantCount).toBe(0);
  });

  it("answers 404 for an unknown id", async () => {
    const res = await get(`/v1/crm/accounts/${randomUUID()}`);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("answers 404 for another tenant's account (never leaks the row)", async () => {
    const theirs = await insertAccount(OTHER_TENANT, "Other Tenant Org");
    const res = await get(`/v1/crm/accounts/${theirs}`);
    expect(res.statusCode).toBe(404);
    expect(JSON.stringify(res.json())).not.toContain("Other Tenant Org");
  });

  it("answers 404 for an inactive (merged-away) account", async () => {
    const gone = await insertAccount(TENANT, "Merged Away", { status: "inactive" });
    expect((await get(`/v1/crm/accounts/${gone}`)).statusCode).toBe(404);
  });

  it("rejects a malformed id (400) and a caller without a CRM role (403)", async () => {
    expect((await get("/v1/crm/accounts/not-a-uuid")).statusCode).toBe(400);
    expect((await get(`/v1/crm/accounts/${root}`, ["some_other_role"])).statusCode).toBe(403);
  });
});

describe("GET /v1/crm/accounts search + excludeSubtreeOf (GAP-CRM-ACCOUNTS-DETAIL-01)", () => {
  const names = (res: { json: () => { data: Array<{ name: string }> } }) => res.json().data.map((a) => a.name);

  it("matches the name case-insensitively and counts the matching set in meta.total", async () => {
    const res = await get("/v1/crm/accounts?search=alpha&limit=10");
    expect(res.statusCode).toBe(200);
    expect(names(res)).toEqual(["Alpha Desk", "Alpha Ministry", "Alpha Wing"]); // retired one is inactive
    expect(res.json().meta.total).toBe(3);
  });

  it("treats LIKE wildcards as literal text", async () => {
    await insertAccount(TENANT, "100% Pure Foods");
    expect(names(await get("/v1/crm/accounts?search=%25"))).toEqual(["100% Pure Foods"]); // "%" matches only the literal
    expect(names(await get("/v1/crm/accounts?search=_lpha"))).toEqual([]); // "_" is not "any character"
  });

  it("hides the excluded account AND its whole subtree, so a re-parent can't pick a descendant", async () => {
    const res = await get(`/v1/crm/accounts?search=alpha&excludeSubtreeOf=${child}`);
    expect(names(res)).toEqual(["Alpha Ministry"]); // child (Alpha Wing) and grandchild (Alpha Desk) gone
    // The unrelated account is still offered.
    expect(names(await get(`/v1/crm/accounts?search=beta&excludeSubtreeOf=${child}`))).toEqual(["Beta Board"]);
    expect(unrelated).toBeTruthy();
  });

  it("still works without filters (unchanged list contract)", async () => {
    const res = await get("/v1/crm/accounts?limit=5");
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toHaveLength(5);
    expect(res.json().meta.total).toBeGreaterThan(200);
  });
});
