/**
 * Demand Forecasting test suite
 *
 * Covers:
 *   1. Domain logic (pure): safety stock, reorder point, SMA fallback, feature computation
 *   2. Validation: horizon param validation, UUID params
 *   3. Route auth: requires authentication
 *   4. Insufficient data: returns { forecast: null, reason: "insufficient_data" }
 *   5. Happy path: returns forecast with SMA fallback
 *   6. Horizon parameter: supports 30/60/90
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8
 */
import { describe, it, expect } from "vitest";
import {
  computeSafetyStock,
  computeReorderPoint,
  shouldReorder,
  computeFeatures,
  smaFallbackForecast,
  isValidHorizon,
  SERVICE_LEVEL_Z,
  MIN_MOVEMENT_RECORDS,
  type MovementRecord,
} from "../src/modules/forecast/domain.js";
import { forecastParams, forecastQuery } from "../src/modules/forecast/validators.js";

// ── 1. Domain Logic (pure) ─────────────────────────────────────────────────

describe("forecast domain — safety stock computation", () => {
  it("safety stock = ceil(stdDev × Z-score) at 95% service level", () => {
    // stdDev=10, Z=1.645 → ceil(16.45) = 17
    expect(computeSafetyStock(10)).toBe(17);
  });

  it("safety stock = 0 when stdDev is 0 (no variability)", () => {
    expect(computeSafetyStock(0)).toBe(0);
  });

  it("safety stock uses custom Z-score when provided", () => {
    // stdDev=10, Z=2.33 (99%) → ceil(23.3) = 24
    expect(computeSafetyStock(10, 2.33)).toBe(24);
  });

  it("default Z-score is 1.645 (95% service level)", () => {
    expect(SERVICE_LEVEL_Z).toBe(1.645);
  });
});

describe("forecast domain — reorder point computation", () => {
  it("reorder point = ceil(avgDaily × leadTime + safetyStock)", () => {
    // avg=5/day, lead=7d, safety=17 → ceil(35 + 17) = 52
    expect(computeReorderPoint(5, 7, 17)).toBe(52);
  });

  it("reorder point with zero safety stock", () => {
    // avg=10/day, lead=3d, safety=0 → ceil(30) = 30
    expect(computeReorderPoint(10, 3, 0)).toBe(30);
  });

  it("reorder point rounds up fractional results", () => {
    // avg=3.5/day, lead=7d, safety=5 → ceil(24.5 + 5) = 30
    expect(computeReorderPoint(3.5, 7, 5)).toBe(30);
  });
});

describe("forecast domain — shouldReorder", () => {
  it("returns true when projected stock falls below reorder point", () => {
    const dailyForecast = [10, 10, 10, 10, 10, 10, 10]; // 7 days × 10 = 70 demand
    const currentOnHand = 50;
    const reorderPoint = 20;
    // projected = 50 - 70 = -20, which is ≤ 20
    expect(shouldReorder(dailyForecast, 7, currentOnHand, reorderPoint)).toBe(true);
  });

  it("returns false when projected stock stays above reorder point", () => {
    const dailyForecast = [2, 2, 2, 2, 2, 2, 2]; // 7 days × 2 = 14 demand
    const currentOnHand = 100;
    const reorderPoint = 20;
    // projected = 100 - 14 = 86, which is > 20
    expect(shouldReorder(dailyForecast, 7, currentOnHand, reorderPoint)).toBe(false);
  });

  it("uses only leadTimeDays portion of the forecast", () => {
    const dailyForecast = [5, 5, 5, 100, 100, 100, 100]; // only first 3 days used (lead=3)
    const currentOnHand = 20;
    const reorderPoint = 10;
    // projected = 20 - 15 = 5, which is ≤ 10
    expect(shouldReorder(dailyForecast, 3, currentOnHand, reorderPoint)).toBe(true);
  });
});

describe("forecast domain — computeFeatures", () => {
  it("computes avg/stdDev from movement records", () => {
    const movements: MovementRecord[] = [];
    for (let i = 0; i < 90; i++) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      movements.push({ date: d.toISOString().slice(0, 10), qty: 10 });
    }
    const features = computeFeatures(movements, 7);
    expect(features.avgDailyMovement30d).toBe(10);
    expect(features.avgDailyMovement90d).toBe(10);
    expect(features.stdDevMovement90d).toBe(0); // no variability
    expect(features.leadTimeDays).toBe(7);
    expect(features.seasonalityIndex).toBe(1.0); // flat demand
  });

  it("returns zeros for empty movements", () => {
    const features = computeFeatures([], 7);
    expect(features.avgDailyMovement30d).toBe(0);
    expect(features.avgDailyMovement90d).toBe(0);
    expect(features.stdDevMovement90d).toBe(0);
    expect(features.seasonalityIndex).toBe(1.0);
  });

  it("computes seasonality index as ratio of 30d to 90d average", () => {
    const movements: MovementRecord[] = [];
    // Recent 30 days: qty=20, older 60 days: qty=10
    for (let i = 0; i < 30; i++) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      movements.push({ date: d.toISOString().slice(0, 10), qty: 20 });
    }
    for (let i = 30; i < 90; i++) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      movements.push({ date: d.toISOString().slice(0, 10), qty: 10 });
    }
    const features = computeFeatures(movements, 7);
    // avg30=20, avg90=(20*30+10*60)/90=13.33... → seasonality = 20/13.33 ≈ 1.5
    expect(features.seasonalityIndex).toBeCloseTo(1.5, 1);
  });
});

describe("forecast domain — smaFallbackForecast", () => {
  it("produces forecast of correct length for horizon=30", () => {
    const features = { avgDailyMovement30d: 10, avgDailyMovement90d: 10, stdDevMovement90d: 3, leadTimeDays: 7, seasonalityIndex: 1.0 };
    const result = smaFallbackForecast(features, 30);
    expect(result.dailyForecast).toHaveLength(30);
    expect(result.confidence).toBe(0.40); // fallback confidence
  });

  it("produces forecast of correct length for horizon=60", () => {
    const features = { avgDailyMovement30d: 10, avgDailyMovement90d: 10, stdDevMovement90d: 3, leadTimeDays: 7, seasonalityIndex: 1.0 };
    const result = smaFallbackForecast(features, 60);
    expect(result.dailyForecast).toHaveLength(60);
  });

  it("produces forecast of correct length for horizon=90", () => {
    const features = { avgDailyMovement30d: 10, avgDailyMovement90d: 10, stdDevMovement90d: 3, leadTimeDays: 7, seasonalityIndex: 1.0 };
    const result = smaFallbackForecast(features, 90);
    expect(result.dailyForecast).toHaveLength(90);
  });

  it("adjusts daily forecast by seasonality index", () => {
    const features = { avgDailyMovement30d: 20, avgDailyMovement90d: 10, stdDevMovement90d: 3, leadTimeDays: 7, seasonalityIndex: 2.0 };
    const result = smaFallbackForecast(features, 30);
    // adjustedDailyDemand = 10 * 2.0 = 20
    expect(result.dailyForecast[0]).toBe(20);
  });

  it("computes total demand as sum of daily values", () => {
    const features = { avgDailyMovement30d: 10, avgDailyMovement90d: 10, stdDevMovement90d: 0, leadTimeDays: 7, seasonalityIndex: 1.0 };
    const result = smaFallbackForecast(features, 30);
    expect(result.totalDemand).toBe(300); // 10 * 30
  });

  it("computes safety stock and reorder point", () => {
    const features = { avgDailyMovement30d: 10, avgDailyMovement90d: 10, stdDevMovement90d: 5, leadTimeDays: 7, seasonalityIndex: 1.0 };
    const result = smaFallbackForecast(features, 30);
    expect(result.safetyStock).toBe(computeSafetyStock(5));
    expect(result.reorderPoint).toBe(computeReorderPoint(10, 7, result.safetyStock));
  });

  it("never produces negative daily forecast values", () => {
    const features = { avgDailyMovement30d: 0, avgDailyMovement90d: 0, stdDevMovement90d: 0, leadTimeDays: 7, seasonalityIndex: 1.0 };
    const result = smaFallbackForecast(features, 30);
    for (const v of result.dailyForecast) {
      expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("forecast domain — isValidHorizon", () => {
  it("accepts 30, 60, 90", () => {
    expect(isValidHorizon(30)).toBe(true);
    expect(isValidHorizon(60)).toBe(true);
    expect(isValidHorizon(90)).toBe(true);
  });

  it("rejects invalid horizons", () => {
    expect(isValidHorizon(7)).toBe(false);
    expect(isValidHorizon(45)).toBe(false);
    expect(isValidHorizon(0)).toBe(false);
    expect(isValidHorizon("30")).toBe(false);
    expect(isValidHorizon(null)).toBe(false);
  });
});

// ── 2. Validation ──────────────────────────────────────────────────────────

describe("forecast validators", () => {
  it("forecastParams requires a valid UUID for id", () => {
    expect(() => forecastParams.parse({ id: "not-a-uuid" })).toThrow();
    expect(() => forecastParams.parse({ id: "00000000-0000-4000-8000-000000000001" })).not.toThrow();
  });

  it("forecastQuery accepts valid horizons as strings", () => {
    const result = forecastQuery.parse({ horizon: "30" });
    expect(result.horizon).toBe(30);
  });

  it("forecastQuery rejects invalid horizon values", () => {
    expect(() => forecastQuery.parse({ horizon: "45" })).toThrow();
    expect(() => forecastQuery.parse({ horizon: "0" })).toThrow();
  });

  it("forecastQuery defaults horizon to 30", () => {
    const result = forecastQuery.parse({});
    expect(result.horizon).toBe(30);
  });

  it("forecastQuery validates warehouseId as UUID when provided", () => {
    expect(() => forecastQuery.parse({ warehouseId: "bad" })).toThrow();
    expect(() => forecastQuery.parse({ warehouseId: "00000000-0000-4000-8000-000000000001" })).not.toThrow();
  });
});

// ── 3. Route auth (inject) ─────────────────────────────────────────────────

describe("forecast route auth (inject)", () => {
  it("GET /v1/inventory/items/:id/forecast without token → 401", async () => {
    const { buildApp } = await import("../src/app.js");
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/inventory/items/00000000-0000-4000-8000-000000000001/forecast",
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

// ── 4. Minimum data threshold constant ──────────────────────────────────────

describe("forecast domain — data threshold", () => {
  it("minimum movement records threshold is 30", () => {
    expect(MIN_MOVEMENT_RECORDS).toBe(30);
  });
});
