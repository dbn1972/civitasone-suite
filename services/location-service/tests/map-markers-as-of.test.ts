/**
 * GAP-LOCATIONS-MAPS-MONITORING-02: GET /v1/locations/map-markers?date=YYYY-MM-DD answers "which records
 * existed on that (IST) day". Real DB, PostGIS-gated like the rest of the marker suite.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";
import { isPostGISAvailable } from "./setup.js";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { sqlClient } from "../src/shared/db.js";
import { registerInfrastructureConsumers } from "../src/modules/infrastructure/consumer.js";
import type { FastifyInstance } from "fastify";

const HAS_POSTGIS = await isPostGISAvailable();
const describePostGIS = HAS_POSTGIS ? describe : describe.skip;

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ACTOR = randomUUID();
const headers = { authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles: ["location_admin", "asset_admin"], sid: "s" }, SECRET, 3600)}`, "content-type": "application/json" };
const drain = () => (queue as unknown as MemoryQueue).drain();

let app: FastifyInstance;
const ids: Record<string, string> = {};

type Feed = { markers: Array<{ label: string }>; meta: { asOf: string | null; statusIsCurrent: boolean; total: number } };
const feed = async (qs = "") => {
  const r = await app.inject({ method: "GET", url: `/v1/locations/map-markers${qs}`, headers });
  return { status: r.statusCode, body: r.json() as Feed };
};
const labels = (f: Feed) => f.markers.map((m) => m.label).sort();

beforeAll(async () => {
  registerInfrastructureConsumers(queue);
  app = await buildApp();
  for (const name of ["Old Bridge", "Edge Bridge", "New Bridge"]) {
    const r = await app.inject({ method: "POST", url: "/v1/locations/infrastructure", headers, payload: { name, type: "bridge", lat: 20, lng: 78 } });
    ids[name] = r.json().data.id;
  }
  await drain();
  // location.infrastructure_assets is RLS-forced: back-date through the tenant GUC.
  const setCreated = (name: string, iso: string) =>
    withRawTenantGuc(sqlClient, TENANT, (tx) => tx.unsafe(`UPDATE location.infrastructure_assets SET created_at = $1::timestamptz WHERE id = $2`, [iso, ids[name]!]));
  await setCreated("Old Bridge", "2019-06-01T10:00:00+05:30");
  await setCreated("Edge Bridge", "2020-01-01T23:30:00+05:30"); // last half hour of 1 Jan 2020, IST
});
afterAll(async () => {
  await withRawTenantGuc(sqlClient, TENANT, (tx) => tx.unsafe(`DELETE FROM location.infrastructure_assets WHERE tenant_id = $1`, [TENANT])).catch(() => undefined);
  await app.close();
  await sqlClient.end();
});

describePostGIS("map-markers as-of date", () => {
  it("without a date every record is returned and the meta says it is the live view", async () => {
    const f = await feed();
    expect(labels(f.body)).toEqual(["Edge Bridge", "New Bridge", "Old Bridge"]);
    expect(f.body.meta.asOf).toBeNull();
    expect(f.body.meta.statusIsCurrent).toBe(true);
  });

  it("excludes records created after the date", async () => {
    const f = await feed("?date=2020-01-01");
    expect(labels(f.body)).toEqual(["Edge Bridge", "Old Bridge"]);
    expect(f.body.meta.asOf).toBe("2020-01-01");
    expect((await feed("?date=2019-12-31")).body.markers.map((m) => m.label)).toEqual(["Old Bridge"]);
  });

  it("treats the date as an IST calendar day (a record made late that evening still existed on it)", async () => {
    expect(labels((await feed("?date=2020-01-01")).body)).toContain("Edge Bridge");
    expect(labels((await feed("?date=2019-12-31")).body)).not.toContain("Edge Bridge");
  });

  it("a far-future date is the whole set; a date before anything existed is an honest empty set", async () => {
    expect((await feed("?date=2099-12-31")).body.markers).toHaveLength(3);
    const none = await feed("?date=2000-01-01");
    expect(none.status).toBe(200);
    expect(none.body.markers).toHaveLength(0);
  });

  it("combines with the other filters", async () => {
    expect((await feed("?date=2020-01-01&domain=parcel")).body.markers).toHaveLength(0);
    expect((await feed("?date=2020-01-01&domain=infrastructure&bbox=77,19,79,21")).body.markers).toHaveLength(2);
    expect((await feed("?date=2020-01-01&domain=infrastructure&bbox=0,0,1,1")).body.markers).toHaveLength(0);
  });

  it("rejects a malformed or impossible date with 400", async () => {
    for (const bad of ["2020-1-1", "yesterday", "2026-02-30", "2020-01-01T00:00:00Z"]) {
      expect((await feed(`?date=${encodeURIComponent(bad)}`)).status).toBe(400);
    }
  });
});
