/**
 * UAT-P2-D1 (/locations/maps/monitoring): GET /v1/locations/map-markers
 * returned 500 `relation "location.cadastral_parcels" does not exist` on a
 * cluster without PostGIS (migrations 0014 / 0019 never applied). The feed now
 * probes its PostGIS-backed sources with to_regclass and leaves out the ones
 * that are absent, instead of failing the whole UNION.
 *
 * Unit-level: the DB layer is mocked, so this runs with or without PostGIS and
 * pins exactly which relations the generated SQL reads.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const executed: string[] = [];
let probe: Record<string, string | null> = {};

vi.mock("../src/shared/db.js", () => ({
  db: {},
  scopedRead: async (fn: (tx: { execute: (q: SQL) => Promise<unknown[]> }) => Promise<unknown>) =>
    fn({
      execute: async (q: SQL) => {
        const text = new PgDialect().sqlToQuery(q).sql;
        executed.push(text);
        if (text.includes("to_regclass")) return [probe];
        return [];
      },
    }),
}));

const { markers } = await import("../src/modules/map-markers/repo.js");

describe("map-markers feed skips absent PostGIS-backed sources (UAT-P2-D1)", () => {
  beforeEach(() => {
    executed.length = 0;
  });

  it("without PostGIS tables it reads only infrastructure assets (no 42P01 -> 500)", async () => {
    probe = { parcels: null, geo_points: null, geofences: null };
    await expect(markers("t1", {}, 10)).resolves.toEqual([]);
    const feed = executed.find((q) => q.includes("infrastructure_assets"))!;
    expect(feed).toBeTruthy();
    expect(feed).not.toContain("cadastral_parcels");
    expect(feed).not.toContain("geo_points");
    expect(feed).not.toContain("geofence.geofences");
  });

  it("with every source present it aggregates all four", async () => {
    probe = { parcels: "location.cadastral_parcels", geo_points: "location.geo_points", geofences: "geofence.geofences" };
    await markers("t1", {}, 10);
    const feed = executed.find((q) => q.includes("infrastructure_assets"))!;
    expect(feed).toContain("location.cadastral_parcels");
    expect(feed).toContain("location.geo_points");
    expect(feed).toContain("geofence.geofences");
  });

  it("only the missing source is left out", async () => {
    probe = { parcels: null, geo_points: "location.geo_points", geofences: null };
    await markers("t1", { domain: "sensor" }, 10);
    const feed = executed.find((q) => q.includes("infrastructure_assets"))!;
    expect(feed).not.toContain("cadastral_parcels");
    expect(feed).toContain("location.geo_points");
  });
});
