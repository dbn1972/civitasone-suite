/**
 * Pure, DB-free unit tests for bookings/domain.ts and enforcement/domain.ts.
 * No Postgres, no queue — safe to run in parallel with the DB-backed suite
 * in tests/parking-lifecycle.test.ts.
 */
import { describe, it, expect } from "vitest";
import {
  canTransition as bookingCanTransition,
  fromStatusesFor as bookingFromStatusesFor,
  generateBookingNumber,
  calculateParkingFee,
} from "../src/modules/bookings/domain.js";
import {
  canTransition as violationCanTransition,
  fromStatusesFor as violationFromStatusesFor,
  generateViolationNumber,
  calculateFineMinor,
} from "../src/modules/enforcement/domain.js";

describe("bookings/domain.ts — status transitions", () => {
  it("booked -> active and booked -> cancelled are legal", () => {
    expect(bookingCanTransition("booked", "active")).toBe(true);
    expect(bookingCanTransition("booked", "cancelled")).toBe(true);
  });

  it("active -> completed is legal, but active -> cancelled is not", () => {
    expect(bookingCanTransition("active", "completed")).toBe(true);
    expect(bookingCanTransition("active", "cancelled")).toBe(false);
  });

  it("completed and cancelled are terminal", () => {
    expect(bookingCanTransition("completed", "active")).toBe(false);
    expect(bookingCanTransition("cancelled", "active")).toBe(false);
  });

  it("fromStatusesFor derives the reverse mapping used to guard repo.updateStatus atomically", () => {
    expect(bookingFromStatusesFor("active")).toEqual(["booked"]);
    expect(bookingFromStatusesFor("completed")).toEqual(["active"]);
    expect(bookingFromStatusesFor("cancelled")).toEqual(["booked"]);
  });
});

describe("bookings/domain.ts — generateBookingNumber / calculateParkingFee", () => {
  it("formats PKG-B/<code>/<year>/<seq, zero-padded to 6>", () => {
    const year = new Date().getUTCFullYear();
    expect(generateBookingNumber("ULB", 42)).toBe(`PKG-B/ULB/${year}/000042`);
  });

  it("rounds UP any partial hour (1 minute over an hour boundary bills a full extra hour)", () => {
    expect(calculateParkingFee(61, 1000n)).toBe(2000n); // ceil(61/60) = 2 hours
    expect(calculateParkingFee(60, 1000n)).toBe(1000n); // exactly 1 hour
    expect(calculateParkingFee(1, 1000n)).toBe(1000n); // any duration bills >= 1 hour
  });

  it("computes exact bigint fees for a tariff far beyond Number.MAX_SAFE_INTEGER without precision loss", () => {
    const hugeTariff = 9223372036854775807n; // 2^63 - 1
    expect(calculateParkingFee(60, hugeTariff)).toBe(hugeTariff);
  });
});

describe("enforcement/domain.ts — status transitions", () => {
  it("issued -> paid and issued -> contested are legal", () => {
    expect(violationCanTransition("issued", "paid")).toBe(true);
    expect(violationCanTransition("issued", "contested")).toBe(true);
  });

  it("paid, contested and cancelled are all terminal", () => {
    expect(violationCanTransition("paid", "contested")).toBe(false);
    expect(violationCanTransition("contested", "paid")).toBe(false);
    expect(violationCanTransition("cancelled", "paid")).toBe(false);
  });

  it("fromStatusesFor derives the reverse mapping used to guard repo.updateStatus atomically", () => {
    expect(violationFromStatusesFor("paid")).toEqual(["issued"]);
    expect(violationFromStatusesFor("contested")).toEqual(["issued"]);
  });
});

describe("enforcement/domain.ts — generateViolationNumber / calculateFineMinor", () => {
  it("formats PKG-V/<code>/<year>/<seq, zero-padded to 6>", () => {
    const year = new Date().getUTCFullYear();
    expect(generateViolationNumber("ULB", 7)).toBe(`PKG-V/ULB/${year}/000007`);
  });

  it("returns the fixed fine schedule for each known violation type", () => {
    expect(calculateFineMinor("obstruction")).toBe(200000n);
    expect(calculateFineMinor("no_ticket")).toBe(100000n);
    expect(calculateFineMinor("expired")).toBe(50000n);
    expect(calculateFineMinor("wrong_zone")).toBe(75000n);
  });

  it("falls back to the expired-tier fine for an unrecognised violation type", () => {
    expect(calculateFineMinor("something_new")).toBe(50000n);
  });
});
