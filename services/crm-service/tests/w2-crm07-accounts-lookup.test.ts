/**
 * W2 crm cluster 07 (rework) -- GET /v1/crm/accounts `search` and `ids`.
 *
 * The onboarding pages and the opportunity account picker used to page the WHOLE accounts
 * list (up to 25 requests) to find one name: the route ignored `search` and had no
 * lookup-by-id. Now `search` narrows by name and `ids` looks up specific accounts in one
 * request. Both stay inside the caller's tenant and the active-account population.
 *
 * Real route -> DB round trips (needs the disposable Postgres).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

// The vitest config provides JWT_SECRET for every service suite; no literal secret here.
const SECRET = process.env.JWT_SECRET!;

const TENANT = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID();

const ACME = randomUUID();
const ACME_PUNE = randomUUID();
const BETA = randomUUID();
const PERCENT = randomUUID();
const UNDERSCORE = randomUUID();
const GONE = randomUUID(); // inactive
const FOREIGN = randomUUID(); // another tenant

function headers(roles: string[] = ["crm_user"], tenantId = TENANT): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-w2c7-accts" }, SECRET)}`,
    "x-tenant-id": tenantId,
  };
}
async function list(query: string, opts: { headers?: Record<string, string>; noAuth?: boolean } = {}) {
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: `/v1/crm/accounts${query}`,
    ...(opts.noAuth ? {} : { headers: opts.headers ?? headers() }),
  });
  await app.close();
  return res;
}
type Body = { data: Array<{ id: string; name: string }>; meta?: { total: number } };
const names = (res: { json: () => unknown }) => (res.json() as Body).data.map((a) => a.name);

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}
async function cleanup(): Promise<void> {
  for (const t of [TENANT, OTHER]) await scoped(t, (tx) => tx`DELETE FROM crm.accounts WHERE tenant_id = ${t}`);
}

beforeAll(async () => {
  await cleanup();
  await scoped(TENANT, (tx) => tx`
    INSERT INTO crm.accounts (id, tenant_id, name, status, created_by, updated_by) VALUES
      (${ACME}, ${TENANT}, 'Acme Corp', 'active', ${ACTOR}, ${ACTOR}),
      (${ACME_PUNE}, ${TENANT}, 'Acme Pune Office', 'active', ${ACTOR}, ${ACTOR}),
      (${BETA}, ${TENANT}, 'Beta Industries', 'active', ${ACTOR}, ${ACTOR}),
      (${PERCENT}, ${TENANT}, '50% Discount Traders', 'active', ${ACTOR}, ${ACTOR}),
      (${UNDERSCORE}, ${TENANT}, 'Plant_One Works', 'active', ${ACTOR}, ${ACTOR}),
      (${GONE}, ${TENANT}, 'Acme Closed Branch', 'inactive', ${ACTOR}, ${ACTOR})
  `);
  await scoped(OTHER, (tx) => tx`
    INSERT INTO crm.accounts (id, tenant_id, name, status, created_by, updated_by)
    VALUES (${FOREIGN}, ${OTHER}, 'Acme Elsewhere', 'active', ${ACTOR}, ${ACTOR})
  `);
});
afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("GET /v1/crm/accounts?search= (name contains)", () => {
  it("narrows by name, ignoring case, and the total counts the matches", async () => {
    const res = await list("?search=aCmE");
    expect(res.statusCode).toBe(200);
    expect(names(res)).toEqual(["Acme Corp", "Acme Pune Office"]);
    expect((res.json() as Body).meta?.total).toBe(2);
  });

  it("never returns an inactive account or another tenant's account", async () => {
    const found = names(await list("?search=acme"));
    expect(found).not.toContain("Acme Closed Branch");
    expect(found).not.toContain("Acme Elsewhere");
  });

  it("matches % and _ literally, not as wildcards", async () => {
    expect(names(await list(`?search=${encodeURIComponent("50%")}`))).toEqual(["50% Discount Traders"]);
    expect(names(await list(`?search=${encodeURIComponent("t_o")}`))).toEqual(["Plant_One Works"]);
    // A bare "%" or "_" is a literal character here, so it finds only names that contain it.
    expect(names(await list(`?search=${encodeURIComponent("%")}`))).toEqual(["50% Discount Traders"]);
  });

  it("a blank search is no filter (the full active list, unchanged)", async () => {
    const res = await list("?search=%20%20");
    expect((res.json() as Body).meta?.total).toBe(5);
  });

  it("still honours limit/offset on a filtered list", async () => {
    const page = await list("?search=acme&limit=1&offset=1");
    expect(names(page)).toEqual(["Acme Pune Office"]);
    expect((page.json() as Body).meta?.total).toBe(2); // total is the match count, not the page size
  });
});

describe("GET /v1/crm/accounts?ids= (lookup of known ids)", () => {
  it("returns exactly the named active accounts in one request", async () => {
    const res = await list(`?ids=${ACME},${BETA}`);
    expect(res.statusCode).toBe(200);
    expect(names(res)).toEqual(["Acme Corp", "Beta Industries"]);
    expect((res.json() as Body).meta?.total).toBe(2);
  });

  it("an inactive or foreign id is simply absent (a definitive answer, no paging needed)", async () => {
    const res = await list(`?ids=${ACME},${GONE},${FOREIGN},${randomUUID()}`);
    expect(names(res)).toEqual(["Acme Corp"]);
    expect((res.json() as Body).meta?.total).toBe(1);
  });

  it("combines with search (both must match)", async () => {
    expect(names(await list(`?ids=${ACME},${BETA}&search=beta`))).toEqual(["Beta Industries"]);
  });

  it("rejects a malformed id, an empty list and more than 50 ids with a 400 field error", async () => {
    const bad = await list("?ids=not-a-uuid");
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as { fieldErrors: Array<{ field: string }> }).fieldErrors.some((f) => f.field.startsWith("ids"))).toBe(true);
    expect((await list("?ids=")).statusCode).toBe(400);
    const tooMany = Array.from({ length: 51 }, () => randomUUID()).join(",");
    expect((await list(`?ids=${tooMany}`)).statusCode).toBe(400);
  });

  it("accepts exactly 50 ids", async () => {
    const fifty = [ACME, ...Array.from({ length: 49 }, () => randomUUID())].join(",");
    const res = await list(`?ids=${fifty}`);
    expect(res.statusCode).toBe(200);
    expect(names(res)).toEqual(["Acme Corp"]);
  });
});

describe("GET /v1/crm/accounts keeps its contract", () => {
  it("with no filter it lists the tenant's active accounts and the active total, as before", async () => {
    const res = await list("");
    expect(res.statusCode).toBe(200);
    // Sorted before comparing: the row order is the database collation's, not this contract's.
    expect([...names(res)].sort()).toEqual(
      ["50% Discount Traders", "Acme Corp", "Acme Pune Office", "Beta Industries", "Plant_One Works"].sort(),
    );
    expect((res.json() as Body).meta?.total).toBe(5);
  });

  it("still needs a token and a CRM role", async () => {
    expect((await list("?search=acme", { noAuth: true })).statusCode).toBe(401);
    expect((await list("?search=acme", { headers: headers(["viewer"]) })).statusCode).toBe(403);
  });
});
