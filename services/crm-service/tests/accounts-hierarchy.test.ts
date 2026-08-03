/**
 * Account hierarchy tests (CM-002).
 * Tests parent-child relationships, cycle detection, ancestor chain.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { wouldCreateCycle, buildAncestorChain, type AccountNode } from "../src/modules/accounts/hierarchy-domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000010";
const ACTOR = "cccccccc-3333-4000-8000-000000000010";

function token(roles = ["crm_user"], tenantId = TENANT) {
  return signToken({ sub: ACTOR, tid: tenantId, roles, sid: "sess-hierarchy" }, SECRET);
}

function headers(roles = ["crm_user"]) {
  return {
    authorization: `Bearer ${token(roles)}`,
    "x-tenant-id": TENANT,
  };
}

const PARENT_ID = "11111111-aaaa-4000-8000-000000000001";
const CHILD_ID = "11111111-aaaa-4000-8000-000000000002";
const GRANDCHILD_ID = "11111111-aaaa-4000-8000-000000000003";
const ORPHAN_ID = "11111111-aaaa-4000-8000-000000000004";

async function seedAccounts(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`
      INSERT INTO crm.accounts (id, tenant_id, name, parent_id, created_by, updated_by)
      VALUES
        (${PARENT_ID}, ${TENANT}, 'Parent Corp', null, ${ACTOR}, ${ACTOR}),
        (${CHILD_ID}, ${TENANT}, 'Child Inc', ${PARENT_ID}, ${ACTOR}, ${ACTOR}),
        (${GRANDCHILD_ID}, ${TENANT}, 'Grandchild Ltd', ${CHILD_ID}, ${ACTOR}, ${ACTOR}),
        (${ORPHAN_ID}, ${TENANT}, 'Orphan LLC', null, ${ACTOR}, ${ACTOR})
      ON CONFLICT (id) DO NOTHING
    `;
  });
}

async function cleanupAccounts(): Promise<void> {
  await sqlClient.begin(async (tx) => {
    await tx`SELECT set_config('app.tenant_id', ${TENANT}, true)`;
    await tx`DELETE FROM crm.accounts WHERE tenant_id = ${TENANT}`.catch(() => {});
  }).catch(() => {});
}

afterAll(async () => {
  await cleanupAccounts();
  await sqlClient.end();
});

beforeAll(async () => {
  await cleanupAccounts();
  await seedAccounts();
});

describe("hierarchy-domain (pure unit tests)", () => {
  it("detects self-reference cycle", () => {
    const map = new Map<string, AccountNode>();
    map.set("a", { id: "a", parentId: null });
    expect(wouldCreateCycle("a", "a", map)).toBe(true);
  });

  it("detects direct cycle (A → B → A)", () => {
    const map = new Map<string, AccountNode>();
    map.set("a", { id: "a", parentId: null });
    map.set("b", { id: "b", parentId: "a" });
    // Setting A.parentId = B would create A→B→A
    expect(wouldCreateCycle("a", "b", map)).toBe(true);
  });

  it("detects indirect cycle (A → B → C → A)", () => {
    const map = new Map<string, AccountNode>();
    map.set("a", { id: "a", parentId: null });
    map.set("b", { id: "b", parentId: "a" });
    map.set("c", { id: "c", parentId: "b" });
    // Setting A.parentId = C would create A→C→B→A
    expect(wouldCreateCycle("a", "c", map)).toBe(true);
  });

  it("allows valid parent assignment (no cycle)", () => {
    const map = new Map<string, AccountNode>();
    map.set("a", { id: "a", parentId: null });
    map.set("b", { id: "b", parentId: null });
    map.set("c", { id: "c", parentId: "b" });
    expect(wouldCreateCycle("c", "a", map)).toBe(false);
  });

  it("builds ancestor chain correctly", () => {
    const map = new Map<string, AccountNode>();
    map.set("root", { id: "root", parentId: null });
    map.set("mid", { id: "mid", parentId: "root" });
    map.set("leaf", { id: "leaf", parentId: "mid" });
    const ancestors = buildAncestorChain("leaf", map);
    expect(ancestors).toEqual(["mid", "root"]);
  });

  it("returns empty ancestors for root node", () => {
    const map = new Map<string, AccountNode>();
    map.set("root", { id: "root", parentId: null });
    expect(buildAncestorChain("root", map)).toEqual([]);
  });

  it("handles max depth limit", () => {
    const map = new Map<string, AccountNode>();
    for (let i = 0; i <= 60; i++) {
      map.set(`n${i}`, { id: `n${i}`, parentId: i > 0 ? `n${i - 1}` : null });
    }
    const ancestors = buildAncestorChain("n60", map);
    expect(ancestors.length).toBeLessThanOrEqual(50);
  });
});

describe("GET /v1/crm/accounts/:id/children", () => {
  it("returns child accounts", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/accounts/${PARENT_ID}/children`,
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data).toBeInstanceOf(Array);
    expect(body.data.some((c: { id: string }) => c.id === CHILD_ID)).toBe(true);
  });

  it("returns empty array for leaf account", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/accounts/${GRANDCHILD_ID}/children`,
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/accounts/${PARENT_ID}/children`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/accounts/${PARENT_ID}/children`,
      headers: { authorization: `Bearer ${token(["citizen"])}`, "x-tenant-id": TENANT },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/crm/accounts/:id/ancestors", () => {
  it("returns ancestor chain for grandchild", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/accounts/${GRANDCHILD_ID}/ancestors`,
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.length).toBe(2);
    expect(body.data[0].id).toBe(CHILD_ID);
    expect(body.data[1].id).toBe(PARENT_ID);
  });

  it("returns empty for root account", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/accounts/${PARENT_ID}/ancestors`,
      headers: headers(),
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual([]);
  });

  it("returns 404 for non-existent account", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/crm/accounts/ffffffff-ffff-4000-8000-ffffffffffff/ancestors`,
      headers: headers(),
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

describe("PATCH /v1/crm/accounts/:id/parent", () => {
  it("sets parent successfully → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/accounts/${ORPHAN_ID}/parent`,
      headers: headers(),
      payload: { parentId: PARENT_ID },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
    expect(res.json().id).toBe(ORPHAN_ID);
  });

  it("clears parent (set to null) → 202", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/accounts/${ORPHAN_ID}/parent`,
      headers: headers(),
      payload: { parentId: null },
    });
    await app.close();

    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("rejects cycle (child as parent of its ancestor)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/accounts/${PARENT_ID}/parent`,
      headers: headers(),
      payload: { parentId: GRANDCHILD_ID },
    });
    await app.close();

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("CYCLE_DETECTED");
  });

  it("rejects self-reference", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/accounts/${PARENT_ID}/parent`,
      headers: headers(),
      payload: { parentId: PARENT_ID },
    });
    await app.close();

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("CYCLE_DETECTED");
  });

  it("returns 404 for non-existent parent", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/accounts/${ORPHAN_ID}/parent`,
      headers: headers(),
      payload: { parentId: "ffffffff-ffff-4000-8000-ffffffffffff" },
    });
    await app.close();

    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for invalid UUID", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/crm/accounts/not-a-uuid/parent`,
      headers: headers(),
      payload: { parentId: PARENT_ID },
    });
    await app.close();

    expect(res.statusCode).toBe(400);
  });
});
