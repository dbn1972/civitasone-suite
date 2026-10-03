/**
 * GAP-HR-LOCATIONS-02 -- edit (PATCH) keeps the hierarchy a tree, and
 * PATCH /v1/locations/:id/archive actually exists (the web Archive action
 * called it, but it 404'd) -- real DB (migration 0025 widens the status CHECK).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerLocationConsumers } from "../src/modules/locations/consumer.js";

registerLocationConsumers(queue);
const drain = () => (queue as unknown as MemoryQueue).drain();

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const h = (roles: string[]) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`, "content-type": "application/json" });
const admin = () => h(["location_admin"]);

let app: FastifyInstance;
let stateId: string;
let districtId: string;

async function create(payload: Record<string, unknown>): Promise<string> {
  const r = await app.inject({ method: "POST", url: "/v1/locations", headers: admin(), payload });
  expect(r.statusCode).toBe(202);
  await drain();
  return (r.json() as { id: string }).id;
}
const get = async (id: string) => (await app.inject({ method: "GET", url: `/v1/locations/${id}`, headers: admin() })).json() as Record<string, unknown>;

async function auditFor(id: string): Promise<Array<{ action: string; metadata?: Record<string, unknown> }>> {
  const rows = await sqlClient.unsafe(
    `SELECT payload FROM _outbox.messages WHERE tenant_id = $1 AND topic = 'audit.event.record' AND payload->>'resourceId' = $2 ORDER BY created_at`,
    [TENANT, id],
  ) as unknown as Array<{ payload: { action: string; metadata?: Record<string, unknown> } }>;
  return rows.map((r) => r.payload);
}

beforeAll(async () => {
  app = await buildApp();
  stateId = await create({ name: "Test State", type: "state" });
  districtId = await create({ name: "Test District", type: "district", parentId: stateId });
});
afterAll(async () => {
  await withRawTenantGuc(sqlClient, TENANT, (tx) => tx.unsafe(`DELETE FROM location.locations WHERE tenant_id = $1`, [TENANT])).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

describe("edit (PATCH /v1/locations/:id)", () => {
  it("updates fields (postal code, name)", async () => {
    const r = await app.inject({ method: "PATCH", url: `/v1/locations/${districtId}`, headers: admin(), payload: { postalCode: "110001", name: "Renamed District" } });
    expect(r.statusCode).toBe(202);
    await drain();
    expect(await get(districtId)).toMatchObject({ postalCode: "110001", name: "Renamed District" });
  });

  it("refuses to place a location under itself, under its own descendant, or under an unknown parent (the tree stays a tree)", async () => {
    const self = await app.inject({ method: "PATCH", url: `/v1/locations/${stateId}`, headers: admin(), payload: { parentId: stateId } });
    expect(self.statusCode).toBe(400);
    const cycle = await app.inject({ method: "PATCH", url: `/v1/locations/${stateId}`, headers: admin(), payload: { parentId: districtId } });
    expect(cycle.statusCode).toBe(400);
    expect((cycle.json() as { code: string }).code).toBe("INVALID_PARENT");
    const ghost = await app.inject({ method: "PATCH", url: `/v1/locations/${districtId}`, headers: admin(), payload: { parentId: randomUUID() } });
    expect(ghost.statusCode).toBe(400);
    await drain();
    expect((await get(stateId)).parentId).toBeNull();
  });

  it("only location admins may edit", async () => {
    const r = await app.inject({ method: "PATCH", url: `/v1/locations/${districtId}`, headers: h(["hr_officer"]), payload: { name: "x" } });
    expect(r.statusCode).toBe(403);
  });
});

describe("the generic edit cannot archive (bypass of the archive route)", () => {
  it("PATCH /v1/locations/:id with status 'archived' is refused and the location stays active, even a leaf with no children", async () => {
    const leaf = await create({ name: "Bypass Leaf", type: "office" });
    const r = await app.inject({ method: "PATCH", url: `/v1/locations/${leaf}`, headers: admin(), payload: { status: "archived", reason: "sneaky" } });
    expect(r.statusCode).toBe(400);
    expect((r.json() as { code: string }).code).toBe("USE_ARCHIVE_ENDPOINT");
    await drain();
    expect((await get(leaf)).status).toBe("active");
    // the parent-with-active-children case the archive route guards cannot be sidestepped either
    const parent = await create({ name: "Bypass Parent", type: "district" });
    await create({ name: "Bypass Child", type: "office", parentId: parent });
    expect((await app.inject({ method: "PATCH", url: `/v1/locations/${parent}`, headers: admin(), payload: { status: "archived" } })).statusCode).toBe(400);
    await drain();
    expect((await get(parent)).status).toBe("active");
    // other status changes through the generic edit still work
    expect((await app.inject({ method: "PATCH", url: `/v1/locations/${leaf}`, headers: admin(), payload: { status: "inactive" } })).statusCode).toBe(202);
  });
});

describe("archive (PATCH /v1/locations/:id/archive)", () => {
  it("refuses while the location still has active sub-locations", async () => {
    const r = await app.inject({ method: "PATCH", url: `/v1/locations/${stateId}/archive`, headers: admin(), payload: {} });
    expect(r.statusCode).toBe(409);
    expect((r.json() as { code: string }).code).toBe("HAS_ACTIVE_CHILDREN");
    expect((await get(stateId)).status).toBe("active");
  });

  it("archives a leaf, records the reason in the audit event, and refuses a second archive", async () => {
    const r = await app.inject({ method: "PATCH", url: `/v1/locations/${districtId}/archive`, headers: admin(), payload: { reason: "Office merged into the state HQ" } });
    expect(r.statusCode).toBe(202);
    await drain();
    expect((await get(districtId)).status).toBe("archived");
    const a = (await auditFor(districtId)).find((x) => x.action === "archive");
    expect(a?.metadata).toMatchObject({ status: "archived", reason: "Office merged into the state HQ" });
    const again = await app.inject({ method: "PATCH", url: `/v1/locations/${districtId}/archive`, headers: admin(), payload: {} });
    expect(again.statusCode).toBe(409);
    expect((again.json() as { code: string }).code).toBe("ALREADY_ARCHIVED");
  });

  it("then the parent can be archived; an unknown id is 404; a non-admin is 403; an over-long reason is 400", async () => {
    expect((await app.inject({ method: "PATCH", url: `/v1/locations/${stateId}/archive`, headers: admin(), payload: {} })).statusCode).toBe(202);
    await drain();
    expect((await get(stateId)).status).toBe("archived");
    expect((await app.inject({ method: "PATCH", url: `/v1/locations/${randomUUID()}/archive`, headers: admin(), payload: {} })).statusCode).toBe(404);
    expect((await app.inject({ method: "PATCH", url: `/v1/locations/${stateId}/archive`, headers: h(["employee"]), payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url: `/v1/locations/${districtId}/archive`, headers: admin(), payload: { reason: "x".repeat(501) } })).statusCode).toBe(400);
  });
});

describe("migration 0025", () => {
  it("the status CHECK accepts the three lifecycle states and still rejects anything else", async () => {
    const id = await create({ name: "Check Probe", type: "office" });
    // location.locations is RLS-forced: the probe needs the tenant GUC or its UPDATEs match zero rows
    const setStatus = (status: string) =>
      withRawTenantGuc(sqlClient, TENANT, (tx) => tx.unsafe(`UPDATE location.locations SET status = $1 WHERE id = $2 RETURNING id`, [status, id]));
    for (const ok of ["inactive", "archived", "active"]) {
      expect((await setStatus(ok)).length).toBe(1);
    }
    await expect(setStatus("bogus")).rejects.toThrow();
  });
});
