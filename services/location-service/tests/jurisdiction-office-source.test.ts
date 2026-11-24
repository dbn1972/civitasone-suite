/**
 * UAT: /locations/jurisdictions. The assign form's office picker must list hierarchy.offices - the table
 * jurisdiction.jurisdictions.office_id references - not location.locations (a different table), otherwise every
 * submit violates the FK. Real Postgres.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { administrativeUnits } from "../src/modules/hierarchy/schema.js";
import { offices } from "../src/modules/hierarchy/org-schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER = randomUUID();
const ACTOR = randomUUID();
const tok = (roles: string[], tid = TENANT) => ({ authorization: `Bearer ${signToken({ sub: ACTOR, tid, roles, sid: "s" }, SECRET)}` });

const UNIT = randomUUID();
const UNIT_OTHER = randomUUID();
const OFFICE = randomUUID();
const OFFICE_INACTIVE = randomUUID();
const OFFICE_OTHER = randomUUID();
let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  const row = (id: string, tenantId: string, name: string, isActive = true) => ({
    id, tenantId, code: name.slice(0, 8), name, officeType: "district_office", adminUnitId: tenantId === TENANT ? UNIT : UNIT_OTHER, isActive, createdBy: ACTOR, updatedBy: ACTOR,
  });
  const unit = (id: string, tenantId: string) => ({ id, tenantId, code: id.slice(0, 8), name: "District", type: "district", createdBy: ACTOR, updatedBy: ACTOR });
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(administrativeUnits).values(unit(UNIT, TENANT))));
  await runWithTenant(OTHER, () => db.transaction((tx) => tx.insert(administrativeUnits).values(unit(UNIT_OTHER, OTHER))));
  await runWithTenant(TENANT, () => db.transaction((tx) => tx.insert(offices).values([row(OFFICE, TENANT, "Collectorate"), row(OFFICE_INACTIVE, TENANT, "Closed Office", false)])));
  await runWithTenant(OTHER, () => db.transaction((tx) => tx.insert(offices).values([row(OFFICE_OTHER, OTHER, "Other Tenant Office")])));
});

afterAll(async () => {
  for (const t of [TENANT, OTHER]) {
    await sqlClient.begin(async (sql) => {
      await sql`SELECT set_config('app.tenant_id', ${t}, true)`;
      await sql.unsafe(`DELETE FROM hierarchy.offices WHERE tenant_id = '${t}'`);
    });
  }
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hierarchy/offices", () => {
  it("lists this tenant's active hierarchy.offices by name (the jurisdiction FK target)", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hierarchy/offices", headers: tok(["location_admin"]) });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as Array<{ id: string; name: string }>;
    expect(data.map((o) => o.id)).toEqual([OFFICE]);
    expect(data[0]!.name).toBe("Collectorate");
  });

  it("is role-gated", async () => {
    const res = await app.inject({ method: "GET", url: "/v1/hierarchy/offices", headers: tok(["citizen"]) });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /v1/jurisdictions office validation", () => {
  const body = (officeId: string) => ({ officeId, unitId: randomUUID(), level: "district", isPrimary: false });

  it("rejects an office that is not in hierarchy.offices for this tenant with 422 (not an async FK failure)", async () => {
    for (const id of [randomUUID(), OFFICE_OTHER]) {
      const res = await app.inject({ method: "POST", url: "/v1/jurisdictions", headers: tok(["location_admin"]), payload: body(id) });
      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("INVALID_OFFICE");
    }
  });

  it("accepts a real hierarchy office (202)", async () => {
    const res = await app.inject({ method: "POST", url: "/v1/jurisdictions", headers: tok(["location_admin"]), payload: body(OFFICE) });
    expect(res.statusCode).toBe(202);
  });
});
