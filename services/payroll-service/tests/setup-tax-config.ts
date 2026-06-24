/**
 * Vitest global setup: register FY-versioned tax configs into the engine
 * registry so pure `computeSlip`/engine unit tests (which run without a DB
 * config load) have slabs available. Mirrors the migration 0012 seed.
 */
import { registerTaxConfig } from "../src/modules/tax/engine.js";

const NEW_2025_2026 = {
  slabs: [
    { from: 0, to: 400000, rate: 0 }, { from: 400000, to: 800000, rate: 0.05 },
    { from: 800000, to: 1200000, rate: 0.10 }, { from: 1200000, to: 1600000, rate: 0.15 },
    { from: 1600000, to: 2000000, rate: 0.20 }, { from: 2000000, to: 2400000, rate: 0.25 },
    { from: 2400000, to: Infinity, rate: 0.30 },
  ],
  stdDeduction: 75000, rebateIncomeCap: 1200000, rebateMax: 60000,
  surchargeBands: [
    { above: 5000000, rate: 0.10 }, { above: 10000000, rate: 0.15 },
    { above: 20000000, rate: 0.25 }, { above: 50000000, rate: 0.25 },
  ],
};
const OLD = {
  slabs: [
    { from: 0, to: 250000, rate: 0 }, { from: 250000, to: 500000, rate: 0.05 },
    { from: 500000, to: 1000000, rate: 0.20 }, { from: 1000000, to: Infinity, rate: 0.30 },
  ],
  stdDeduction: 50000, rebateIncomeCap: 500000, rebateMax: 12500,
  surchargeBands: [
    { above: 5000000, rate: 0.10 }, { above: 10000000, rate: 0.15 },
    { above: 20000000, rate: 0.25 }, { above: 50000000, rate: 0.37 },
  ],
};
registerTaxConfig("new", 2024, {
  slabs: [
    { from: 0, to: 300000, rate: 0 }, { from: 300000, to: 700000, rate: 0.05 },
    { from: 700000, to: 1000000, rate: 0.10 }, { from: 1000000, to: 1200000, rate: 0.15 },
    { from: 1200000, to: 1500000, rate: 0.20 }, { from: 1500000, to: Infinity, rate: 0.30 },
  ],
  stdDeduction: 75000, rebateIncomeCap: 700000, rebateMax: 25000,
  surchargeBands: NEW_2025_2026.surchargeBands,
});
registerTaxConfig("new", 2025, NEW_2025_2026);
registerTaxConfig("new", 2026, NEW_2025_2026);
registerTaxConfig("old", 2024, OLD);
registerTaxConfig("old", 2025, OLD);
registerTaxConfig("old", 2026, OLD);
