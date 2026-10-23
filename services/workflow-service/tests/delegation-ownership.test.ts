/**
 * DELEG-REVOKE-OWNERSHIP: delegation revoke + list are scoped to the parties.
 *  - DELETE: only the delegator or a workflow admin (workflow_admin / super_admin /
 *    tenant_admin) may revoke; anyone else gets 403 and an audited refusal row.
 *  - GET list: a plain user sees only delegations where they are delegator OR
 *    delegate; admins see the whole tenant. ?mine / ?toMe / ?delegatorId /
 *    ?delegateId filters (the id filters are admin-only). Total honours the scope.
 * Real DB; rows are seeded through the repo (asTenant), requests go through buildApp().
 */
import { describe, it, expect, afterAll, afterEach, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerDelegationConsumers } from "../src/modules/delegations/consumer.js";
import * as delegationRepo from "../src/modules/delegations/repo.js";
import { sqlAsTenant, asTenant } from "./helpers/engine-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

registerDelegationConsumers(queue);
await queue.start();

const tenants: string[] = [];
let TENANT = "";
const ALICE = randomUUID(); // delegator
const BOB = randomUUID();   // delegate
const CAROL = randomUUID(); // unrelated plain user
const DAVE = randomUUID();  // another delegator
const ADMIN = randomUUID();

const tok = (actorId: string, roles: string[] = ["workflow_user"]) =>
  `Bearer ${signToken({ sub: actorId, tid: TENANT, roles, sid: "sess-own" }, SECRET)}`;

async function seed(delegatorId: string, delegateId: string): Promise<string> {
  const id = randomUUID();
  await asTenant(TENANT, () => delegationRepo.create({
    id, tenantId: TENANT, delegatorId, delegateId, roles: ["workflow_user"],
    fromDate: "2025-01-01", toDate: "2025-03-01", reason: null,
  }));
  return id;
}

async function isActive(id: string): Promise<boolean> {
  const r = await sqlAsTenant(TENANT, sql`SELECT is_active FROM workflow.workflow_delegations WHERE id = ${id}`) as unknown as Array<{ is_active: boolean }>;
  return r[0]!.is_active;
}

async function waitInactive(id: string): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 3000) {
    if (!(await isActive(id))) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("revoke did not apply");
}

beforeEach(() => { TENANT = randomUUID(); tenants.push(TENANT); });
afterEach(async () => {
  for (const t of tenants.splice(0)) {
    await sqlAsTenant(t, sql`DELETE FROM workflow.workflow_delegations WHERE tenant_id = ${t}`);
    await sqlAsTenant(t, sql`DELETE FROM _outbox.messages WHERE tenant_id = ${t}`);
  }
});
afterAll(async () => { await sqlClient.end(); });

const del = (app: Awaited<ReturnType<typeof buildApp>>, id: string, auth: string) =>
  app.inject({ method: "DELETE", url: `/v1/workflow/delegations/${id}`, headers: { authorization: auth } });
const list = (app: Awaited<ReturnType<typeof buildApp>>, auth: string, qs = "") =>
  app.inject({ method: "GET", url: `/v1/workflow/delegations${qs}`, headers: { authorization: auth } });

describe("DELETE /v1/workflow/delegations/:id ownership", () => {
  it("a plain user who is not the delegator gets 403, nothing is revoked, and the refusal is audited", async () => {
    const app = await buildApp();
    const id = await seed(ALICE, BOB);
    const res = await del(app, id, tok(CAROL));
    await app.close();
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("NOT_DELEGATOR");
    expect(await isActive(id)).toBe(true);
    const start = Date.now();
    let refusal: Record<string, unknown> | undefined;
    while (!refusal && Date.now() - start < 3000) {
      const audit = await sqlAsTenant(TENANT,
        sql`SELECT payload FROM _outbox.messages WHERE tenant_id = ${TENANT} AND topic = 'audit.event.record'`) as unknown as Array<{ payload: Record<string, unknown> }>;
      refusal = audit.map((a) => a.payload).find((p) => p.resourceId === id);
      if (!refusal) await new Promise((r) => setTimeout(r, 25));
    }
    expect(refusal).toMatchObject({ resourceType: "delegation", action: "revoke", outcome: "denied" });
  });

  it("the delegate (not the delegator) cannot revoke either", async () => {
    const app = await buildApp();
    const id = await seed(ALICE, BOB);
    const res = await del(app, id, tok(BOB));
    await app.close();
    expect(res.statusCode).toBe(403);
    expect(await isActive(id)).toBe(true);
  });

  it("the delegator can revoke their own delegation", async () => {
    const app = await buildApp();
    const id = await seed(ALICE, BOB);
    const res = await del(app, id, tok(ALICE));
    expect(res.statusCode).toBe(202);
    await waitInactive(id);
    await app.close();
    expect(await isActive(id)).toBe(false);
  });

  it.each(["workflow_admin", "super_admin", "tenant_admin"])("%s can revoke anyone's delegation", async (role) => {
    const app = await buildApp();
    const id = await seed(ALICE, BOB);
    const res = await del(app, id, tok(ADMIN, [role]));
    expect(res.statusCode).toBe(202);
    await waitInactive(id);
    await app.close();
    expect(await isActive(id)).toBe(false);
  });

  it("returns 404 for an unknown id", async () => {
    const app = await buildApp();
    const res = await del(app, randomUUID(), tok(ALICE));
    await app.close();
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /v1/workflow/delegations scoping + filters", () => {
  async function fixture() {
    return {
      aliceToBob: await seed(ALICE, BOB),
      daveToAlice: await seed(DAVE, ALICE),
      daveToBob: await seed(DAVE, BOB),
      daveToCarol: await seed(DAVE, CAROL),
    };
  }
  const ids = (r: { json: () => { data: Array<{ id: string }> } }) => r.json().data.map((d) => d.id).sort();

  it("a plain user sees only delegations where they are delegator or delegate, total included", async () => {
    const app = await buildApp();
    const f = await fixture();
    const res = await list(app, tok(ALICE));
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(ids(res)).toEqual([f.aliceToBob, f.daveToAlice].sort());
    expect(res.json().total).toBe(2);
  });

  it("a plain user with no delegations sees an empty list even when the tenant has others", async () => {
    const app = await buildApp();
    await fixture();
    const res = await list(app, tok(randomUUID()));
    await app.close();
    expect(res.json().data).toEqual([]);
    expect(res.json().total).toBe(0);
  });

  it("an admin sees the whole tenant", async () => {
    const app = await buildApp();
    const f = await fixture();
    const res = await list(app, tok(ADMIN, ["workflow_admin"]));
    await app.close();
    expect(ids(res)).toEqual(Object.values(f).sort());
    expect(res.json().total).toBe(4);
  });

  it("?mine=true returns only delegations where the caller is delegator", async () => {
    const app = await buildApp();
    const f = await fixture();
    const res = await list(app, tok(ALICE), "?mine=true");
    await app.close();
    expect(ids(res)).toEqual([f.aliceToBob]);
    expect(res.json().total).toBe(1);
  });

  it("?toMe=true returns only delegations where the caller is delegate", async () => {
    const app = await buildApp();
    const f = await fixture();
    const res = await list(app, tok(BOB), "?toMe=true");
    await app.close();
    expect(ids(res)).toEqual([f.aliceToBob, f.daveToBob].sort());
    expect(res.json().total).toBe(2);
  });

  it("?mine=true&toMe=true intersects (self-delegations only)", async () => {
    const app = await buildApp();
    await fixture();
    const res = await list(app, tok(ALICE), "?mine=true&toMe=true");
    await app.close();
    expect(res.json().data).toEqual([]);
    expect(res.json().total).toBe(0);
  });

  it("?delegatorId and ?delegateId work for admins", async () => {
    const app = await buildApp();
    const f = await fixture();
    const admin = tok(ADMIN, ["tenant_admin"]);
    const byDelegator = await list(app, admin, `?delegatorId=${DAVE}`);
    const byDelegate = await list(app, admin, `?delegateId=${BOB}`);
    const both = await list(app, admin, `?delegatorId=${DAVE}&delegateId=${BOB}`);
    await app.close();
    expect(ids(byDelegator)).toEqual([f.daveToAlice, f.daveToBob, f.daveToCarol].sort());
    expect(byDelegator.json().total).toBe(3);
    expect(ids(byDelegate)).toEqual([f.aliceToBob, f.daveToBob].sort());
    expect(ids(both)).toEqual([f.daveToBob]);
  });

  it("?delegatorId / ?delegateId are refused (403) for a plain user", async () => {
    const app = await buildApp();
    await fixture();
    const a = await list(app, tok(ALICE), `?delegatorId=${DAVE}`);
    const b = await list(app, tok(ALICE), `?delegateId=${BOB}`);
    await app.close();
    expect(a.statusCode).toBe(403);
    expect(b.statusCode).toBe(403);
  });

  it("rejects a non-uuid id filter with 400", async () => {
    const app = await buildApp();
    const res = await list(app, tok(ADMIN, ["workflow_admin"]), "?delegatorId=nope");
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("pagination keeps the scoped total", async () => {
    const app = await buildApp();
    await fixture();
    const res = await list(app, tok(ALICE), "?limit=1&offset=0");
    const page2 = await list(app, tok(ALICE), "?limit=1&offset=1");
    await app.close();
    expect(res.json().data).toHaveLength(1);
    expect(res.json().total).toBe(2);
    expect(page2.json().data).toHaveLength(1);
    expect(page2.json().data[0].id).not.toBe(res.json().data[0].id);
  });
});
