/**
 * CM-001 multiple addresses. HTTP -> consumer -> DB round-trips: CRUD, the
 * one-primary-per-owner invariant, cross-tenant RLS, and 404s.
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerAllConsumers } from "../src/consumers.js";
import { drainQueue } from "./consumer-harness.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000cd001";
const OTHER = "aaaaaaaa-1111-4000-8000-0000000cd009";
const ACTOR = "cccccccc-3333-4000-8000-0000000cd001";
const OWNER = "22222222-bbbb-4000-8000-0000000cd001";

function headers(tenant = TENANT, roles = ["crm_user"]) {
  return { authorization: `Bearer ${signToken({ sub: ACTOR, tid: tenant, roles, sid: "s" }, SECRET)}`, "x-tenant-id": tenant };
}

async function cleanup() {
  for (const t of [TENANT, OTHER]) {
    await sqlClient.begin(async (tx) => {
      await tx`SELECT set_config('app.tenant_id', ${t}, true)`;
      await tx`DELETE FROM crm.addresses WHERE tenant_id = ${t}`.catch(() => {});
    }).catch(() => {});
  }
}

beforeAll(async () => { await cleanup(); registerAllConsumers(queue); await queue.start(); });
afterAll(async () => { await drainQueue(); await cleanup(); await sqlClient.end(); });

async function create(payload: Record<string, unknown>, tenant = TENANT) {
  const app = await buildApp();
  const res = await app.inject({ method: "POST", url: "/v1/crm/addresses", headers: headers(tenant), payload });
  await app.close();
  await drainQueue();
  return res;
}

async function list(tenant = TENANT) {
  const app = await buildApp();
  const res = await app.inject({ method: "GET", url: `/v1/crm/addresses?ownerType=contact&ownerId=${OWNER}`, headers: headers(tenant) });
  await app.close();
  return res.json().data as Array<Record<string, unknown>>;
}

const base = { ownerType: "contact", ownerId: OWNER, line1: "1 MG Road", city: "Bengaluru", country: "IN" };

describe("CM-001 addresses CRUD", () => {
  it("creates an address (202) and reads it back", async () => {
    const res = await create({ ...base, addressType: "office", isPrimary: true });
    expect(res.statusCode).toBe(202);
    const rows = await list();
    expect(rows.length).toBe(1);
    expect(rows[0].addressType).toBe("office");
    expect(rows[0].isPrimary).toBe(true);
  });

  it("enforces one primary per owner: a new primary demotes the old", async () => {
    await create({ ...base, addressType: "billing", isPrimary: true });
    const rows = await list();
    const primaries = rows.filter((r) => r.isPrimary === true);
    expect(primaries.length).toBe(1);
    expect(primaries[0].addressType).toBe("billing");
  });

  it("updates an address (202)", async () => {
    const created = await create({ ...base, addressType: "shipping", isPrimary: false });
    const id = created.json().id;
    const app = await buildApp();
    const res = await app.inject({ method: "PUT", url: `/v1/crm/addresses/${id}`, headers: headers(), payload: { city: "Chennai" } });
    await app.close();
    await drainQueue();
    expect(res.statusCode).toBe(202);
    const row = (await list()).find((r) => r.id === id);
    expect(row!.city).toBe("Chennai");
  });

  it("promoting one address to primary via PUT demotes the previous primary", async () => {
    const rows = await list();
    const nonPrimary = rows.find((r) => r.isPrimary === false)!;
    const app = await buildApp();
    await app.inject({ method: "PUT", url: `/v1/crm/addresses/${nonPrimary.id}`, headers: headers(), payload: { isPrimary: true } });
    await app.close();
    await drainQueue();
    const after = await list();
    expect(after.filter((r) => r.isPrimary === true).length).toBe(1);
    expect(after.find((r) => r.id === nonPrimary.id)!.isPrimary).toBe(true);
  });

  it("deletes an address (202)", async () => {
    const created = await create({ ...base, addressType: "home", isPrimary: false });
    const id = created.json().id;
    const app = await buildApp();
    const res = await app.inject({ method: "DELETE", url: `/v1/crm/addresses/${id}`, headers: headers() });
    await app.close();
    await drainQueue();
    expect(res.statusCode).toBe(202);
    expect((await list()).map((r) => r.id)).not.toContain(id);
  });

  it("404s a PUT/DELETE on a missing address", async () => {
    const app = await buildApp();
    const put = await app.inject({ method: "PUT", url: `/v1/crm/addresses/ffffffff-ffff-4000-8000-ffffffffffff`, headers: headers(), payload: { city: "X" } });
    const del = await app.inject({ method: "DELETE", url: `/v1/crm/addresses/ffffffff-ffff-4000-8000-ffffffffffff`, headers: headers() });
    await app.close();
    expect(put.statusCode).toBe(404);
    expect(del.statusCode).toBe(404);
  });

  it("rejects an invalid address_type (400)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/crm/addresses", headers: headers(), payload: { ...base, addressType: "spaceship" } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("does not leak another tenant's addresses (RLS)", async () => {
    await create({ ...base, addressType: "registered", isPrimary: true }, OTHER);
    const otherRows = await list(OTHER);
    expect(otherRows.length).toBe(1); // OTHER sees only its own
  });
});
