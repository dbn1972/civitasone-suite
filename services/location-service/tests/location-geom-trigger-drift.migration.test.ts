/**
 * UAT onboarding gap: no office/location could be created for any tenant.
 *
 * UAT's civitas_location has the 0015 trigger trg_locations_geom but no `geom` column (no PostGIS,
 * so 0011 never ran), so every insert raised `record "new" has no field "geom"` and the create
 * consumer dead-lettered. 0029 makes the trigger function skip `geom` when the row has none.
 *
 * Part 1 rebuilds the drifted state in a rolled-back scratch schema (table with FORCE RLS and the
 * 0015 function body), proves the insert fails, applies 0029 and proves it succeeds, as the
 * service role (NOBYPASSRLS) under the tenant GUC. Part 2 creates a location through the API
 * end to end against the real table, with whatever the DB has (works with and without PostGIS).
 */
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { registerLocationConsumers } from "../src/modules/locations/consumer.js";

const MIGRATION = new URL("../migrations/0029_locations_geom_trigger_tolerant.sql", import.meta.url);
// 0015's function body verbatim: assigns NEW.geom unconditionally.
const OLD_FN = `
CREATE OR REPLACE FUNCTION location.locations_sync_geom() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.latitude IS NOT NULL AND NEW.longitude IS NOT NULL THEN
    NEW.geom := ST_SetSRID(ST_MakePoint(NEW.longitude, NEW.latitude), 4326);
  ELSE
    NEW.geom := NULL;
  END IF;
  RETURN NEW;
END $$;`;
const ROLLBACK = new Error("rollback");

registerLocationConsumers(queue);
const drain = () => (queue as unknown as MemoryQueue).drain();

afterAll(async () => {
  await sqlClient.end();
});

describe("0029 locations_sync_geom tolerates a table without geom (real DB, NOBYPASSRLS role)", () => {
  it("the service role is not a superuser and does not bypass RLS", async () => {
    const [r] = await sqlClient`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(r).toMatchObject({ rolsuper: false, rolbypassrls: false });
  });

  it("drifted table: insert fails on the old function, succeeds after 0029; second run is a no-op", async () => {
    const scratch = `b23a_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    const tenant = randomUUID();
    const sql0029 = await readFile(MIGRATION, "utf-8");
    await sqlClient
      .begin(async (tx) => {
        // The migration targets location.locations_sync_geom; keep the real function out of the
        // picture by replacing it inside this rolled-back transaction only.
        await tx.unsafe(OLD_FN);
        await tx.unsafe(`
          CREATE SCHEMA ${scratch};
          CREATE TABLE ${scratch}.locations (
            id uuid PRIMARY KEY, tenant_id uuid NOT NULL, name varchar(255) NOT NULL,
            latitude double precision, longitude double precision);
          ALTER TABLE ${scratch}.locations ENABLE ROW LEVEL SECURITY;
          ALTER TABLE ${scratch}.locations FORCE ROW LEVEL SECURITY;
          CREATE POLICY t ON ${scratch}.locations
            USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
            WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
          CREATE TRIGGER trg_locations_geom BEFORE INSERT OR UPDATE OF latitude, longitude
            ON ${scratch}.locations FOR EACH ROW EXECUTE FUNCTION location.locations_sync_geom();`);
        await tx`select set_config('app.tenant_id', ${tenant}, true)`;
        const insert = (name: string) => tx.unsafe(
          `INSERT INTO ${scratch}.locations (id, tenant_id, name, latitude, longitude) VALUES ($1, $2, $3, 19.2183, 72.9781)`,
          [randomUUID(), tenant, name],
        );

        // Before: the exact UAT failure. Savepoint so the abort does not poison the transaction.
        await tx.savepoint(async (sp) => {
          await expect(sp.unsafe(
            `INSERT INTO ${scratch}.locations (id, tenant_id, name, latitude, longitude) VALUES ($1, $2, 'Collectorate, Thane', 19.2183, 72.9781)`,
            [randomUUID(), tenant],
          )).rejects.toThrow(/has no field "geom"/);
          throw ROLLBACK;
        }).catch((e) => { if (e !== ROLLBACK) throw e; });

        await tx.unsafe(sql0029);
        await tx.unsafe(sql0029); // idempotent
        await insert("District Collectorate, Thane");
        await tx.unsafe(`UPDATE ${scratch}.locations SET latitude = 19.9975, longitude = 73.7898`); // lat/lng update path
        const rows = await tx.unsafe(`SELECT name, latitude FROM ${scratch}.locations`);
        expect(rows).toHaveLength(1);
        expect(Number(rows[0]!.latitude)).toBeCloseTo(19.9975);
        throw ROLLBACK;
      })
      .catch((e) => { if (e !== ROLLBACK) throw e; });
  });
});

describe("POST /v1/locations end to end creates an office with coordinates", () => {
  const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
  const TENANT = randomUUID();
  const token = signToken({ sub: randomUUID(), tid: TENANT, roles: ["location_admin"], sid: "s" }, SECRET);
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  let app: FastifyInstance;

  beforeAll(async () => { app = await buildApp(); });
  afterAll(async () => {
    await withRawTenantGuc(sqlClient, TENANT, (tx) => tx.unsafe(`DELETE FROM location.locations WHERE tenant_id = $1`, [TENANT])).catch(() => undefined);
    await app.close();
  });

  it("accepts, consumes and persists the location", async () => {
    const r = await app.inject({
      method: "POST", url: "/v1/locations", headers,
      payload: { name: "Sub-Divisional Office, Kalyan", type: "office", latitude: 19.2437, longitude: 73.1355 },
    });
    expect(r.statusCode).toBe(202);
    const id = (r.json() as { id: string }).id;
    await drain();
    const got = await app.inject({ method: "GET", url: `/v1/locations/${id}`, headers });
    expect(got.statusCode).toBe(200);
    expect(got.json()).toMatchObject({ name: "Sub-Divisional Office, Kalyan", latitude: 19.2437, longitude: 73.1355 });
  });
});
