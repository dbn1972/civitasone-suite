/**
 * Fleet domain tests — pure business logic.
 * Validates: mileage, utilisation, running cost, expiry, odometer.
 */
import { describe, it, expect } from "vitest";
import {
  computeMileage, computeUtilisation, computeRunningCostPerKm,
  isExpiringWithin, assertOdometerProgression, DomainError,
} from "../src/modules/fleet/domain.js";

describe("Fleet — mileage calculation", () => {
  it("computes correct km/l", () => {
    expect(computeMileage(10000, 10450, 30)).toBe(15);
  });
  it("rounds to 2 decimal places", () => {
    expect(computeMileage(5000, 5333, 25)).toBe(13.32);
  });
  it("returns null for zero litres", () => {
    expect(computeMileage(1000, 1100, 0)).toBeNull();
  });
  it("returns null for negative litres", () => {
    expect(computeMileage(1000, 1100, -5)).toBeNull();
  });
  it("returns null for no distance (same odometer)", () => {
    expect(computeMileage(5000, 5000, 10)).toBeNull();
  });
  it("returns null for regression (end < start)", () => {
    expect(computeMileage(5000, 4900, 10)).toBeNull();
  });
});

describe("Fleet — utilisation percentage", () => {
  it("100% when trips every day", () => {
    expect(computeUtilisation(30, 30)).toBe(100);
  });
  it("0% when no trips", () => {
    expect(computeUtilisation(0, 30)).toBe(0);
  });
  it("handles zero total days gracefully", () => {
    expect(computeUtilisation(5, 0)).toBe(0);
  });
  it("correct percentage for partial use", () => {
    expect(computeUtilisation(15, 30)).toBe(50);
  });
});

describe("Fleet — running cost per km", () => {
  it("computes cost in paise", () => {
    // 100000 paise fuel / 500 km = 200 paise/km (2.00 INR/km)
    expect(computeRunningCostPerKm(100000n, 500)).toBe(200n);
  });
  it("returns 0 when no km driven", () => {
    expect(computeRunningCostPerKm(50000n, 0)).toBe(0n);
  });
  it("handles large values without overflow", () => {
    // 10 crore paise = 10 lakh INR fuel over 100000 km
    expect(computeRunningCostPerKm(100000000n, 100000)).toBe(1000n);
  });
});

describe("Fleet — document expiry check", () => {
  it("returns true when expiring within reminder window", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 5);
    expect(isExpiringWithin(tomorrow.toISOString().slice(0, 10), 7)).toBe(true);
  });
  it("returns false when far from expiry", () => {
    const farFuture = new Date();
    farFuture.setDate(farFuture.getDate() + 90);
    expect(isExpiringWithin(farFuture.toISOString().slice(0, 10), 7)).toBe(false);
  });
  it("returns false when already expired", () => {
    const past = new Date();
    past.setDate(past.getDate() - 10);
    expect(isExpiringWithin(past.toISOString().slice(0, 10), 7)).toBe(false);
  });
});

describe("Fleet — odometer progression validation", () => {
  it("passes when new >= previous", () => {
    expect(() => assertOdometerProgression(5000, 5100)).not.toThrow();
  });
  it("passes when same (vehicle stationary)", () => {
    expect(() => assertOdometerProgression(5000, 5000)).not.toThrow();
  });
  it("throws on regression (tampering/error)", () => {
    expect(() => assertOdometerProgression(5000, 4900)).toThrow(DomainError);
    expect(() => assertOdometerProgression(5000, 4900)).toThrow("new odometer 4900 < previous 5000");
  });
});
