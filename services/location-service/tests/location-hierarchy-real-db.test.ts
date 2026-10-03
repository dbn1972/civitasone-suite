/**
 * GAP-HR-LOCATIONS-03: GET /v1/locations/:id/hierarchy -- breadcrumb, direct
 * children and every descendant id, tenant-scoped, readable by the HR view
 * roles. Pure builder cases + real Postgres route cases.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { locations, type LocationView } from "../src/modules/locations/schema.js";
import { buildLocationHierarchy } from "../src/modules/locations/hierarchy.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID();

const ids = { state: randomUUID(), district: randomUUID(), blockB: randomUUID(), blockA: randomUUID(), ward: randomUUID(), other: randomUUID() };

const tok = (roles: string[], tid = TENANT) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: "s" }, SECRET)}` });

function view(id: string, name: string, parentId: string | null): LocationView {
  return { id, tenantId: TENANT, name, addressLine: null, city: null, postalCode: null, parentId, type: "office", lgdCode: null, latitude: null, longitude: null, status: "active", isSample: false, version: 1 };
}

describe("buildLocationHierarchy (pure)", () => {
  const rows = [view("a", "State", null), view("b", "District", "a"), view("c", "Block Z", "b"), view("d", "Block A", "b"), view("e", "Ward", "d")];

  it("returns ancestors root-first, children sorted by name, and all descendant ids", () => {
    const h = buildLocationHierarchy(rows, "b")!;
    expect(h.ancestors.map((x) => x.id)).toEqual(["a"]);
    expect(h.children.map((x) => x.name)).toEqual(["Block A", "Block Z"]);
    expect([...h.descendantIds].sort()).toEqual(["c", "d", "e"]);
    expect(buildLocationHierarchy(rows, "e")!.ancestors.map((x) => x.id)).toEqual(["a", "b", "d"]);
    expect(buildLocationHierarchy(rows, "a")!.ancestors).toEqual([]);
  });

  it("returns null for an unknown id and survives a parentId cycle", () => {
    expect(buildLocationHierarchy(rows, "nope")).toBeNull();
    const cyc = [view("x", "X", "y"), view("y", "Y", "x")];
    const h = buildLocationHierarchy(cyc, "x")!;
    expect(h.descendantIds).toEqual(["y"]);
    expect(h.ancestors.map((a) => a.id)).toEqual(["y"]);
  });
});

describe("GET /v1/locations/:id/hierarchy (real DB)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Per-run random service secret for the x-internal path test (never a literal).
    process.env.INTERNAL_SERVICE_SECRET ||= randomUUID();
    app = await buildApp();
    const row = (id: string, name: string, parentId: string | null, tenantId = TENANT) => ({
      id, tenantId, name, parentId, type: "office", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(locations).values([
        row(ids.state, "State", null), row(ids.district, "District", ids.state),
        row(ids.blockB, "Block B", ids.district), row(ids.blockA, "Block A", ids.district), row(ids.ward, "Ward", ids.blockA),
      ]);
    }));
    await runWithTenant(OTHER, () => db.transaction(async (tx) => {
      await tx.insert(locations).values([row(ids.other, "Other tenant office", null, OTHER)]);
    }));
  });

  afterAll(async () => {
    for (const t of [TENANT, OTHER]) {
      await runWithTenant(t, () => db.transaction((tx) => tx.delete(locations).where(eq(locations.tenantId, t))));
    }
    await app.close();
    await sqlClient.end();
  });

  const get = (id: string, headers = tok(["hr_officer"])) => app.inject({ method: "GET", url: `/v1/locations/${id}/hierarchy`, headers });

  it("returns breadcrumb, sorted direct children and all descendant ids", async () => {
    const r = await get(ids.district);
    expect(r.statusCode).toBe(200);
    const b = r.json();
    expect(b.location.name).toBe("District");
    expect(b.ancestors.map((a: { name: string }) => a.name)).toEqual(["State"]);
    expect(b.children.map((c: { name: string }) => c.name)).toEqual(["Block A", "Block B"]);
    expect([...b.descendantIds].sort()).toEqual([ids.blockA, ids.blockB, ids.ward].sort());
  });

  it("is tenant-scoped: another tenant's id is a 404, not data", async () => {
    expect((await get(ids.other)).statusCode).toBe(404);
    expect((await get(ids.state, tok(["hr_admin"], OTHER))).statusCode).toBe(404);
  });

  it("admits the HR view roles and the internal service call, rejects others", async () => {
    for (const roles of [["hr_admin"], ["hr_officer"], ["location_user"], ["super_admin"]]) {
      expect((await get(ids.state, tok(roles))).statusCode).toBe(200);
    }
    expect((await get(ids.state, tok(["payroll_officer"]))).statusCode).toBe(403);
    expect((await get(ids.state, tok([]))).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: `/v1/locations/${ids.state}/hierarchy` })).statusCode).toBe(401);
  });

  it("serves the hrms-service internal path (x-internal + service secret + tenant) and refuses a wrong or missing secret", async () => {
    const internal = (secret: string | undefined) => app.inject({
      method: "GET",
      url: `/v1/locations/${ids.district}/hierarchy`,
      headers: {
        "x-internal": "1", "x-internal-caller": "hrms-service", "x-tenant-id": TENANT,
        ...(secret === undefined ? {} : { "x-service-secret": secret }),
      },
    });
    const ok = await internal(process.env.INTERNAL_SERVICE_SECRET);
    expect(ok.statusCode).toBe(200);
    expect([...ok.json().descendantIds].sort()).toEqual([ids.blockA, ids.blockB, ids.ward].sort());
    // the other tenant's header scopes to that tenant: our district id does not exist there
    const wrongTenant = await app.inject({
      method: "GET", url: `/v1/locations/${ids.district}/hierarchy`,
      headers: { "x-internal": "1", "x-tenant-id": OTHER, "x-service-secret": process.env.INTERNAL_SERVICE_SECRET! },
    });
    expect(wrongTenant.statusCode).toBe(404);
    expect((await internal(`${process.env.INTERNAL_SERVICE_SECRET}-wrong`)).statusCode).toBe(401);
    expect((await internal(undefined)).statusCode).toBe(401);
  });

  it("rejects a non-uuid id", async () => {
    expect((await get("not-a-uuid")).statusCode).toBe(400);
  });
});
