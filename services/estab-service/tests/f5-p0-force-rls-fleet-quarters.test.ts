import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS = join(__dirname, "../migrations");

describe("F5 P0 FORCE RLS on fleet + quarters", () => {
  it("0040 forces RLS on all eight tenant tables", () => {
    const src = readFileSync(join(MIGRATIONS, "0040_force_rls_fleet_quarters.sql"), "utf8");
    for (const table of [
      "quarters.estab_quarters",
      "quarters.estab_quarter_allotments",
      "quarters.estab_licence_fee_rates",
      "quarters.estab_overstay_penalties",
      "fleet.fuel_logs",
      "fleet.trip_logs",
      "fleet.vehicle_documents",
      "fleet.driver_roster",
    ]) {
      expect(src).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    }
  });

  it("files GET detail has no route-layer db.transaction write", () => {
    const routes = readFileSync(
      join(__dirname, "../src/modules/files/routes.ts"),
      "utf8",
    );
    expect(routes).not.toMatch(/await\s+db\.transaction/);
    expect(routes).toContain("queue.publish");
    expect(routes).toContain("access_denied_clearance");
  });

  it("migration set includes 0040", () => {
    const files = readdirSync(MIGRATIONS);
    expect(files).toContain("0040_force_rls_fleet_quarters.sql");
  });
});
