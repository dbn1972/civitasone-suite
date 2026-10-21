/**
 * W2 crm cluster 07 (rework) -- GET /v1/crm/deals?ids= (lookup of known deal ids).
 *
 * The onboarding list names a page of cases by deal id. The deals list had no id filter, so the
 * page walked the whole list (up to 25 sequential requests), and a case whose deal is no longer
 * live (deleted or cancelled deals are never listed) made every load walk it to the end. `ids`
 * looks the named deals up in ONE request; a deal that is not live, or belongs to another tenant,
 * is simply absent, which is a definitive answer.
 *
 * Real route -> queue -> consumer -> DB round trips (needs the disposable Postgres).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

// The vitest config provides JWT_SECRET for every service suite; no literal secret here.
const SECRET = process.env.JWT_SECRET!;

const TENANT = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID();

function headers(roles: string[] = ["crm_user"], tenantId = TENANT): Record<string, string> {
  return {
    authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-w2c7-deal-ids" }, SECRET)}`,
    "x-tenant-id": tenantId,
  };
}
async function call(method: "GET" | "POST", url: string, opts: { headers?: Record<string, string>; payload?: unknown; noAuth?: boolean } = {}) {
  const app = await buildApp();
  const res = await app.inject({
    method,
    url,
    ...(opts.noAuth ? {} : { headers: opts.headers ?? headers(["crm_admin"]) }),
    ...(opts.payload === undefined ? {} : { payload: opts.payload }),
  });
  await app.close();
  await drainQueue();
  return res;
}
type Body = { data: Array<{ id: string; name: string }>; pagination: { total: number; pageSize: number } };
const names = (res: { json: () => unknown }) => (res.json() as Body).data.map((d) => d.name).sort();

type Tx = Parameters<Parameters<typeof sqlClient.begin>[0]>[0];
function scoped<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  }) as Promise<T>;
}
async function cleanup(): Promise<void> {
  for (const t of [TENANT, OTHER]) await scoped(t, (tx) => tx`DELETE FROM crm.deals WHERE tenant_id = ${t}`);
}
async function createDeal(name: string, tenantId = TENANT): Promise<string> {
  const res = await call("POST", "/v1/crm/deals", { headers: headers(["crm_admin"], tenantId), payload: { name } });
  expect(res.statusCode).toBe(202);
  return (res.json() as { id: string }).id;
}
async function setStatus(id: string, status: string, tenantId = TENANT): Promise<void> {
  await scoped(tenantId, (tx) => tx`UPDATE crm.deals SET status = ${status} WHERE id = ${id} AND tenant_id = ${tenantId}`);
}

let ACME = "";
let BETA = "";
let DELETED = "";
let CANCELLED = "";
let FOREIGN = "";

beforeAll(async () => {
  registerAllConsumers(queue);
  await queue.start();
  await cleanup();
  ACME = await createDeal("Acme renewal");
  BETA = await createDeal("Beta expansion");
  DELETED = await createDeal("Deleted deal");
  CANCELLED = await createDeal("Cancelled deal");
  FOREIGN = await createDeal("Elsewhere deal", OTHER);
  await setStatus(DELETED, "deleted");
  await setStatus(CANCELLED, "cancelled");
});
afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("GET /v1/crm/deals?ids= (lookup of known ids)", () => {
  it("returns exactly the named live deals in one request, with the matching total", async () => {
    const res = await call("GET", `/v1/crm/deals?ids=${ACME},${BETA}`, { headers: headers() });
    expect(res.statusCode).toBe(200);
    expect(names(res)).toEqual(["Acme renewal", "Beta expansion"]);
    expect((res.json() as Body).pagination.total).toBe(2);
  });

  it("a deleted, cancelled, unknown or other-tenant id is simply absent (a definitive answer, no paging needed)", async () => {
    const res = await call("GET", `/v1/crm/deals?ids=${ACME},${DELETED},${CANCELLED},${FOREIGN},${randomUUID()}`, { headers: headers() });
    expect(res.statusCode).toBe(200);
    expect(names(res)).toEqual(["Acme renewal"]);
    expect((res.json() as Body).pagination.total).toBe(1);
  });

  it("is not served from a stale list cache: a deal created after an earlier lookup is found by the next one", async () => {
    const first = await call("GET", `/v1/crm/deals?ids=${ACME}`, { headers: headers() });
    expect(names(first)).toEqual(["Acme renewal"]);
    const late = await createDeal("Late deal");
    const again = await call("GET", `/v1/crm/deals?ids=${ACME},${late}`, { headers: headers() });
    expect(names(again)).toEqual(["Acme renewal", "Late deal"]);
  });

  it("combines with limit/offset", async () => {
    const res = await call("GET", `/v1/crm/deals?ids=${ACME},${BETA}&limit=1`, { headers: headers() });
    expect((res.json() as Body).data).toHaveLength(1);
    expect((res.json() as Body).pagination.total).toBe(2);
  });

  it("rejects a malformed id, an empty list and more than 50 ids with a 400 field error", async () => {
    const bad = await call("GET", "/v1/crm/deals?ids=not-a-uuid", { headers: headers() });
    expect(bad.statusCode).toBe(400);
    expect((bad.json() as { fieldErrors: Array<{ field: string }> }).fieldErrors.some((f) => f.field.startsWith("ids"))).toBe(true);
    expect((await call("GET", "/v1/crm/deals?ids=", { headers: headers() })).statusCode).toBe(400);
    const tooMany = Array.from({ length: 51 }, () => randomUUID()).join(",");
    expect((await call("GET", `/v1/crm/deals?ids=${tooMany}`, { headers: headers() })).statusCode).toBe(400);
  });

  it("accepts exactly 50 ids", async () => {
    const fifty = [ACME, ...Array.from({ length: 49 }, () => randomUUID())].join(",");
    const res = await call("GET", `/v1/crm/deals?ids=${fifty}`, { headers: headers() });
    expect(res.statusCode).toBe(200);
    expect(names(res)).toEqual(["Acme renewal"]);
  });
});

describe("GET /v1/crm/deals keeps its contract without ids", () => {
  it("lists the tenant's live deals and their total, never another tenant's or a deleted/cancelled one", async () => {
    const res = await call("GET", "/v1/crm/deals?limit=200", { headers: headers() });
    expect(res.statusCode).toBe(200);
    const found = names(res);
    expect(found).toContain("Acme renewal");
    expect(found).toContain("Beta expansion");
    expect(found).not.toContain("Deleted deal");
    expect(found).not.toContain("Cancelled deal");
    expect(found).not.toContain("Elsewhere deal");
  });

  it("still needs a token and a CRM role", async () => {
    expect((await call("GET", `/v1/crm/deals?ids=${ACME}`, { noAuth: true })).statusCode).toBe(401);
    expect((await call("GET", `/v1/crm/deals?ids=${ACME}`, { headers: headers(["viewer"]) })).statusCode).toBe(403);
  });
});
