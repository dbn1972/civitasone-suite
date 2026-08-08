/**
 * FN-16 — Reporting & Analytics per Service.
 * FN-31 — Per-Service KPI Dashboard.
 *
 * BRD acceptance (FN-16): "new Certificate pack gets working Issued Register
 * without extra config."
 * BRD acceptance (FN-31): "publish new pack → dashboard populates."
 */
import { describe, it, expect } from "vitest";
import {
  dashboardTilesForPack,
  reportTemplatesForPack,
  type AnalyticsBlocks,
} from "./service-analytics.js";
import { SERVICE_PATTERNS } from "../catalogue/domain.js";
import { eventPermissionManifestBlocks } from "./manifests/event-permission.js";
import { hallBookingManifestBlocks } from "./manifests/hall-booking.js";

const PAID: AnalyticsBlocks = { slaDays: 7, feeFromMinor: 50000, feeModel: "flat" };
const FREE: AnalyticsBlocks = { slaDays: 7, feeFromMinor: 0 };
const NO_SLA: AnalyticsBlocks = { feeFromMinor: 50000, feeModel: "flat" };

const keys = (xs: { key: string }[]) => xs.map((x) => x.key);

describe("FN-16 reportTemplatesForPack — BRD acceptance", () => {
  it("a new Certificate pack gets a working Issued Register with no extra config", () => {
    const reports = reportTemplatesForPack("certificate", eventPermissionManifestBlocks());
    const register = reports.find((r) => r.key === "issued_register");

    expect(register?.title).toBe("Issued Register");
    // "Working" means it has real columns, not an empty shell (the UAT #23 defect).
    expect(register?.columns).toContain("applicationNumber");
    expect(register?.columns).toContain("outputNumber");
    expect(register?.columns).toContain("issuedAt");
    expect(register?.columns).toContain("processingDays");
    expect(register?.filters.length).toBeGreaterThan(0);
    expect(register?.audience).toContain("department_head");
  });

  it("gives every pattern a register and a pending report, with no empty columns", () => {
    for (const pattern of SERVICE_PATTERNS) {
      const reports = reportTemplatesForPack(pattern, PAID);
      expect(reports.length, pattern).toBeGreaterThanOrEqual(2);
      expect(keys(reports), pattern).toContain("pending_sla_breach");
      for (const r of reports) {
        expect(r.columns.length, `${pattern}/${r.key}`).toBeGreaterThan(0);
        expect(r.purpose.length, `${pattern}/${r.key}`).toBeGreaterThan(0);
      }
    }
  });

  it("names each pattern's register for what that pattern produces", () => {
    expect(keys(reportTemplatesForPack("certificate", PAID))).toContain("issued_register");
    expect(keys(reportTemplatesForPack("booking", PAID))).toContain("booking_register");
    expect(keys(reportTemplatesForPack("collection", PAID))).toContain("demand_collection_register");
    expect(keys(reportTemplatesForPack("grievance", FREE))).toContain("grievance_register");
  });

  it("withholds a revenue report from a free service", () => {
    // An empty revenue report reads as "collection has failed", not "n/a".
    expect(keys(reportTemplatesForPack("certificate", FREE))).not.toContain("revenue_vs_demand");
    expect(keys(reportTemplatesForPack("certificate", PAID))).toContain("revenue_vs_demand");
  });

  it("withholds a revenue report from a grievance service", () => {
    expect(keys(reportTemplatesForPack("grievance", {}))).not.toContain("revenue_vs_demand");
  });

  it("does not duplicate revenue for collection, whose register already carries it", () => {
    const reports = reportTemplatesForPack("collection", PAID);
    expect(keys(reports)).not.toContain("revenue_vs_demand");
    expect(reports.find((r) => r.key === "demand_collection_register")?.columns).toContain("collectedMinor");
  });

  it("treats a slab/formula pack with no flat amount as charging", () => {
    // The amount resolves at runtime; withholding the report would hide real money.
    expect(keys(reportTemplatesForPack("certificate", { feeModel: "slab" }))).toContain("revenue_vs_demand");
  });

  it("drops SLA columns and retitles when the service has no SLA", () => {
    const withSla = reportTemplatesForPack("certificate", PAID).find((r) => r.key === "pending_sla_breach")!;
    const without = reportTemplatesForPack("certificate", NO_SLA).find((r) => r.key === "pending_sla_breach")!;

    expect(withSla.title).toBe("Pending & SLA Breach");
    expect(withSla.columns).toContain("slaBreached");

    expect(without.title).toBe("Pending Applications");
    expect(without.columns.some((c) => c.startsWith("sla"))).toBe(false);
    expect(without.filters).not.toContain("slaBreached");
    expect(without.purpose).toMatch(/no sla/i);
  });

  it("works with no blocks at all", () => {
    const reports = reportTemplatesForPack("certificate");
    expect(keys(reports)).toEqual(["issued_register", "pending_sla_breach"]);
  });

  it("emits unique report keys", () => {
    for (const pattern of SERVICE_PATTERNS) {
      const k = keys(reportTemplatesForPack(pattern, PAID));
      expect(new Set(k).size, pattern).toBe(k.length);
    }
  });
});

describe("FN-31 dashboardTilesForPack — BRD acceptance", () => {
  it("a published pack gets the four BRD KPIs with no extra config", () => {
    const tiles = dashboardTilesForPack("certificate", eventPermissionManifestBlocks());
    for (const k of ["volume", "median_processing_days", "sla_compliance", "fee_collection_rate"]) {
      expect(keys(tiles), k).toContain(k);
    }
  });

  it("populates every pattern", () => {
    for (const pattern of SERVICE_PATTERNS) {
      const tiles = dashboardTilesForPack(pattern, PAID);
      expect(tiles.length, pattern).toBeGreaterThanOrEqual(4);
      for (const t of tiles) {
        expect(t.description.length, `${pattern}/${t.key}`).toBeGreaterThan(0);
        expect(["count", "days", "percent"], `${pattern}/${t.key}`).toContain(t.unit);
      }
    }
  });

  it("targets the median processing tile at the pack's own SLA", () => {
    const tile = dashboardTilesForPack("certificate", PAID).find((t) => t.key === "median_processing_days")!;
    expect(tile.target).toBe(7);
    expect(tile.higherIsBetter).toBe(false);
  });

  it("omits the SLA target rather than defaulting it when no SLA is set", () => {
    const tile = dashboardTilesForPack("certificate", NO_SLA).find((t) => t.key === "median_processing_days")!;
    expect(tile).not.toHaveProperty("target");
    expect(keys(dashboardTilesForPack("certificate", NO_SLA))).not.toContain("sla_compliance");
  });

  it("omits the fee tile for a free service", () => {
    // A permanent "0% collected" on a free service is a false alarm.
    expect(keys(dashboardTilesForPack("certificate", FREE))).not.toContain("fee_collection_rate");
  });

  it("marks direction so a tile cannot be read the wrong way round", () => {
    const tiles = dashboardTilesForPack("certificate", PAID);
    expect(tiles.find((t) => t.key === "sla_compliance")?.higherIsBetter).toBe(true);
    expect(tiles.find((t) => t.key === "rejection_rate")?.higherIsBetter).toBe(false);
    expect(tiles.find((t) => t.key === "volume")?.higherIsBetter).toBe(true);
  });

  it("adds the pattern-appropriate outcome tile", () => {
    expect(keys(dashboardTilesForPack("certificate", PAID))).toContain("rejection_rate");
    expect(keys(dashboardTilesForPack("booking", hallBookingManifestBlocks()))).toContain("rejection_rate");
    expect(keys(dashboardTilesForPack("grievance", FREE))).toContain("escalation_rate");
    // Grievances are not "rejected" in the certificate sense.
    expect(keys(dashboardTilesForPack("grievance", FREE))).not.toContain("rejection_rate");
  });

  it("invents no metric the data model cannot answer", () => {
    // No status records a no-show or cancellation, so no permanently-zero tile.
    const all = SERVICE_PATTERNS.flatMap((p) => keys(dashboardTilesForPack(p, PAID)));
    expect(all).not.toContain("no_show_rate");
    expect(all).not.toContain("cancellation_rate");
  });

  it("emits unique tile keys", () => {
    for (const pattern of SERVICE_PATTERNS) {
      const k = keys(dashboardTilesForPack(pattern, PAID));
      expect(new Set(k).size, pattern).toBe(k.length);
    }
  });

  it("works with no blocks at all", () => {
    const tiles = dashboardTilesForPack("collection");
    expect(keys(tiles)).toEqual(["volume", "median_processing_days", "disposal_rate"]);
  });
});

describe("FN-16/FN-31 — the shipped packs", () => {
  it.each([
    ["event-permission", "certificate" as const, eventPermissionManifestBlocks()],
    ["hall-booking", "booking" as const, hallBookingManifestBlocks()],
  ])("%s gets reports and a dashboard on publish", (_name, pattern, blocks) => {
    const reports = reportTemplatesForPack(pattern, blocks);
    const tiles = dashboardTilesForPack(pattern, blocks);

    // Both packs charge a fee and set an SLA, so both must get the full set.
    expect(keys(reports)).toContain("revenue_vs_demand");
    expect(keys(tiles)).toContain("fee_collection_rate");
    expect(keys(tiles)).toContain("sla_compliance");
    expect(tiles.find((t) => t.key === "median_processing_days")?.target).toBe(blocks.slaDays);
  });
});
