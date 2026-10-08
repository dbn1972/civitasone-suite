import { getAggregateHealth } from "./queries.js";
import type { AggregateHealth } from "./domain.js";

export type ReadinessGateResult = Record<string, boolean>;
export type ReadinessScoreResult = Record<string, number>;

export type ProductionReadiness = {
  overall: number;
  productionReady: boolean;
  allGreen: boolean;
  gates: ReadinessGateResult;
  scores: ReadinessScoreResult;
  checkedAt: string;
};

// GAP2-TENANT-ADMIN-READINESS-07: readiness must reflect the LIVE platform
// state, not a frozen `true/100` constant. The previous implementation returned
// `overall:100, productionReady:true, allGreen:true` with every gate `true` and
// every score `100` for every tenant and every deployment — the same
// FABRICATED defect READINESS-01 (fixed on the web) re-introduced here. The
// go-live screen therefore always showed "100% · Ready for go-live", which was
// not derived from anything.
//
// We now derive readiness from the per-service health rollup already computed
// by getAggregateHealth() (which probes every registered service's /health).
// Each gate is a boolean over that live rollup; the overall score is the
// fraction of gates passing. If the health rollup cannot be produced at all,
// we return a null snapshot so the UI shows its honest "not available" state
// rather than a fabricated 100%.

/** Derive the live gate map from an aggregate health rollup. */
export function deriveGates(health: AggregateHealth): ReadinessGateResult {
  const total = health.services.length;
  const healthy = health.services.filter((s) => s.status === "ok").length;
  return {
    // All probed services responded healthy.
    allServicesHealthy: total > 0 && healthy === total,
    // The platform is not in a hard-down state (at least one service is up).
    platformResponsive: health.status !== "down",
    // No service is currently reporting unhealthy.
    noServiceDown: total > 0 && healthy === total,
    // Enough of the fleet is up to serve traffic (quorum ≥ half).
    serviceQuorum: total > 0 && healthy * 2 >= total,
  };
}

/** Per-dimension scores (0-100) derived from the live rollup. */
function deriveScores(health: AggregateHealth): ReadinessScoreResult {
  const total = health.services.length;
  const healthy = total > 0 ? health.services.filter((s) => s.status === "ok").length : 0;
  const healthPct = total > 0 ? Math.round((healthy / total) * 100) : 0;
  return {
    serviceHealth: healthPct,
    availability: health.status === "ok" ? 100 : health.status === "degraded" ? 50 : 0,
  };
}

/** Pure core so tests can drive it with a synthetic health rollup (no network). */
export function readinessFromHealth(health: AggregateHealth): ProductionReadiness {
  const gates = deriveGates(health);
  const scores = deriveScores(health);
  const gateValues = Object.values(gates);
  const passed = gateValues.filter(Boolean).length;
  const allGreen = gateValues.length > 0 && passed === gateValues.length;
  const overall = gateValues.length > 0 ? Math.round((passed / gateValues.length) * 100) : 0;
  return {
    overall,
    productionReady: allGreen,
    allGreen,
    gates,
    scores,
    checkedAt: health.checkedAt,
  };
}

/**
 * Compute readiness from live signals. Returns `null` when the health rollup
 * cannot be produced, so the route can surface an honest "not available at
 * runtime" state instead of fabricating readiness.
 */
export async function computeProductionReadiness(): Promise<ProductionReadiness | null> {
  const health = await getAggregateHealth();
  if (!health || health.services.length === 0) return null;
  return readinessFromHealth(health);
}
