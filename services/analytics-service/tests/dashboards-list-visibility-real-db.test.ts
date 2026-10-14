/**
 * GAP-ANALYTICS-DASHBOARDS-03 (W2): GET /v1/analytics/dashboards listed every
 * dashboard in the tenant, including other people's PRIVATE ones, to any reader,
 * while GET /:id already 404'd them (canView). The list must agree with the
 * detail: owner | admin | shared-with-me only.
 *
 * Real analytics Postgres (analytics_svc, FORCE RLS), real HTTP layer via inject.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "beef0000-0000-4000-8000-0000000d3a01";
const OTHER_TENANT = "beef0000-0000-4000-8000-0000000d3a02";
const ALICE = "beef0000-0000-4000-a000-0000000d3a11";
const BOB = "beef0000-0000-4000-a000-0000000d3a12";
const CAROL = "beef0000-0000-4000-a000-0000000d3a13";
const ADMIN = "beef0000-0000-4000-a000-0000000d3a14";

const asT = <T,>(t: string, fn: (tx: typeof sqlClient) => Promise<T>) => withRawTenantGuc(sqlClient, t, fn);
const token = (sub: string, roles: string[], tid = TENANT) => signToken({ sub, tid, roles, sid: `s-${sub}` }, SECRET);

async function list(sub: string, roles: string[]): Promise<string[]> {
  const app = await buildApp();
  const res = await app.inject({
    method: "GET",
    url: "/v1/analytics/dashboards",
    headers: { authorization: `Bearer ${token(sub, roles)}`, "x-tenant-id": TENANT },
  });
  await app.close();
  expect(res.statusCode).toBe(200);
  return (res.json().data as Array<{ name: string }>).map((d) => d.name).sort();
}

async function cleanup(): Promise<void> {
  for (const t of [TENANT, OTHER_TENANT]) {
    await asT(t, (tx) => tx`DELETE FROM analytics.dashboard_shares WHERE tenant_id = ${t}`);
    await asT(t, (tx) => tx`DELETE FROM analytics.dashboards WHERE tenant_id = ${t}`);
  }
}

beforeAll(async () => {
  await cleanup();
  await asT(TENANT, async (tx) => {
    const ins = async (name: string, owner: string, visibility: string) => {
      const [r] = await tx`INSERT INTO analytics.dashboards (tenant_id, name, owner_id, visibility, created_by, updated_by)
        VALUES (${TENANT}, ${name}, ${owner}, ${visibility}, ${owner}, ${owner}) RETURNING id`;
      return r!.id as string;
    };
    await ins("alice-private", ALICE, "private");
    const sharedWithBob = await ins("alice-shared-with-bob", ALICE, "shared");
    await ins("alice-shared-nobody", ALICE, "shared");
    await ins("bob-private", BOB, "private");
    await tx`INSERT INTO analytics.dashboard_shares (tenant_id, dashboard_id, principal_id, access, created_by)
      VALUES (${TENANT}, ${sharedWithBob}, ${BOB}, 'view', ${ALICE})`;
  });
  // A same-named row in another tenant must never surface.
  await asT(OTHER_TENANT, (tx) => tx`INSERT INTO analytics.dashboards (tenant_id, name, owner_id, visibility, created_by, updated_by)
    VALUES (${OTHER_TENANT}, 'foreign-shared', ${ALICE}, 'shared', ${ALICE}, ${ALICE})`);
}, 60_000);

afterAll(async () => {
  await cleanup();
  await sqlClient.end();
});

describe("dashboards list agrees with canView (real DB)", () => {
  it("an admin sees the whole tenant (and warms the shared cache first)", async () => {
    expect(await list(ADMIN, ["analytics_admin"])).toEqual([
      "alice-private",
      "alice-shared-nobody",
      "alice-shared-with-bob",
      "bob-private",
    ]);
  });

  it("a non-admin sees only what they own plus what is shared with them", async () => {
    expect(await list(BOB, ["analytics_user"])).toEqual(["alice-shared-with-bob", "bob-private"]);
    expect(await list(ALICE, ["analytics_user"])).toEqual([
      "alice-private",
      "alice-shared-nobody",
      "alice-shared-with-bob",
    ]);
  });

  it("a reader with no ownership and no share sees nothing, and never another tenant's rows", async () => {
    expect(await list(CAROL, ["analytics_user"])).toEqual([]);
  });

  it("every listed dashboard is openable by the same viewer (list never advertises a 404)", async () => {
    const app = await buildApp();
    const headers = { authorization: `Bearer ${token(BOB, ["analytics_user"])}`, "x-tenant-id": TENANT };
    const listed = (await app.inject({ method: "GET", url: "/v1/analytics/dashboards", headers })).json().data as Array<{ id: string }>;
    for (const d of listed) {
      const r = await app.inject({ method: "GET", url: `/v1/analytics/dashboards/${d.id}`, headers });
      expect(r.statusCode).toBe(200);
    }
    await app.close();
  });
});
