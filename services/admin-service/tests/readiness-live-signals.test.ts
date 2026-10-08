/**
 * GAP2-TENANT-ADMIN-READINESS-07 — readiness must be derived from the LIVE
 * per-service health rollup, not a frozen overall:100 / productionReady:true /
 * every-gate-true constant. These are pure unit tests over the derivation
 * functions (no network, no DB) so they are deterministic.
 *
 * They fail on the OLD code: `readiness.ts` previously exported only
 * `computeProductionReadiness()` returning a hard-coded 100/true snapshot and
 * had no `readinessFromHealth`/`deriveGates` to import.
 */
import { describe, it, expect } from "vitest";
import { readinessFromHealth, deriveGates } from "../src/modules/health/readiness.js";
import type { AggregateHealth } from "../src/modules/health/domain.js";

function health(services: Array<{ service: string; status: string }>, status: AggregateHealth["status"]): AggregateHealth {
  return { status, services, checkedAt: "2026-10-08T00:00:00.000Z" };
}

describe("readinessFromHealth (live signals)", () => {
  it("all services healthy → productionReady:true, overall:100, all gates pass", () => {
    const r = readinessFromHealth(
      health([{ service: "identity-service", status: "ok" }, { service: "billing-service", status: "ok" }], "ok"),
    );
    expect(r.productionReady).toBe(true);
    expect(r.overall).toBe(100);
    expect(r.allGreen).toBe(true);
    expect(r.gates.allServicesHealthy).toBe(true);
    expect(r.checkedAt).toBe("2026-10-08T00:00:00.000Z");
  });

  it("one dependency unhealthy → productionReady:false and the failing gate(s) are false", () => {
    const r = readinessFromHealth(
      health([{ service: "identity-service", status: "ok" }, { service: "billing-service", status: "down" }], "degraded"),
    );
    expect(r.productionReady).toBe(false);
    expect(r.allGreen).toBe(false);
    expect(r.overall).toBeLessThan(100);
    expect(r.gates.allServicesHealthy).toBe(false);
    expect(r.gates.noServiceDown).toBe(false);
    // quorum still met (1 of 2 healthy), platform still responsive
    expect(r.gates.serviceQuorum).toBe(true);
    expect(r.gates.platformResponsive).toBe(true);
  });

  it("every service down → productionReady:false, overall:0, nothing fabricated", () => {
    const r = readinessFromHealth(
      health([{ service: "identity-service", status: "down" }, { service: "billing-service", status: "down" }], "down"),
    );
    expect(r.productionReady).toBe(false);
    expect(r.overall).toBe(0);
    expect(r.gates.platformResponsive).toBe(false);
    expect(r.gates.serviceQuorum).toBe(false);
  });

  it("deriveGates reflects quorum: majority healthy keeps serviceQuorum true", () => {
    const gates = deriveGates(
      health(
        [
          { service: "a", status: "ok" },
          { service: "b", status: "ok" },
          { service: "c", status: "down" },
        ],
        "degraded",
      ),
    );
    expect(gates.serviceQuorum).toBe(true);
    expect(gates.allServicesHealthy).toBe(false);
  });
});
