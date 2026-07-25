/**
 * Spaces domain tests — pure business logic.
 * Validates: allotment state machine, maker-checker, no-double-book,
 * occupancy/availability computation, prorated licence-fee.
 */
import { describe, it, expect } from "vitest";
import {
  assertValidAllotmentTransition, assertMakerChecker, assertSeatAllottable,
  computeOccupancy, availableSeats, computeProratedLicenceFee,
  seatStatusOnAllot, seatStatusOnRelease, DomainError, ACTIVE_ALLOTMENT_STATUSES,
} from "../src/modules/spaces/domain.js";

describe("Spaces — allotment state machine", () => {
  it("allows requested -> allotted", () => {
    expect(() => assertValidAllotmentTransition("requested", "allotted")).not.toThrow();
  });
  it("allows allotted -> occupied", () => {
    expect(() => assertValidAllotmentTransition("allotted", "occupied")).not.toThrow();
  });
  it("allows allotted -> released", () => {
    expect(() => assertValidAllotmentTransition("allotted", "released")).not.toThrow();
  });
  it("allows occupied -> released", () => {
    expect(() => assertValidAllotmentTransition("occupied", "released")).not.toThrow();
  });
  it("allows requested -> cancelled", () => {
    expect(() => assertValidAllotmentTransition("requested", "cancelled")).not.toThrow();
  });
  it("rejects requested -> occupied (skip)", () => {
    expect(() => assertValidAllotmentTransition("requested", "occupied")).toThrow(DomainError);
  });
  it("rejects released -> occupied (backward)", () => {
    expect(() => assertValidAllotmentTransition("released", "occupied")).toThrow(DomainError);
  });
  it("rejects cancelled -> anything (terminal)", () => {
    expect(() => assertValidAllotmentTransition("cancelled", "allotted")).toThrow(DomainError);
  });
});

describe("Spaces — maker-checker enforcement", () => {
  const A = "aaaa0000-0000-4000-8000-000000000001";
  const B = "bbbb0000-0000-4000-8000-000000000002";
  it("throws when approver = requester", () => {
    expect(() => assertMakerChecker(A, A)).toThrow(DomainError);
    expect(() => assertMakerChecker(A, A)).toThrow("allotment approver cannot be the requester");
  });
  it("passes when approver != requester", () => {
    expect(() => assertMakerChecker(A, B)).not.toThrow();
  });
});

describe("Spaces — no double-allot", () => {
  it("permits allotment when the seat has no active allotment", () => {
    expect(() => assertSeatAllottable([{ status: "released" }, { status: "cancelled" }])).not.toThrow();
    expect(() => assertSeatAllottable([])).not.toThrow();
  });
  it("rejects when the seat already has an allotted allotment", () => {
    expect(() => assertSeatAllottable([{ status: "allotted" }])).toThrow(DomainError);
    expect(() => assertSeatAllottable([{ status: "allotted" }])).toThrow("seat already has an active allotment");
  });
  it("rejects when the seat is occupied", () => {
    expect(() => assertSeatAllottable([{ status: "occupied" }])).toThrow(DomainError);
  });
  it("ACTIVE_ALLOTMENT_STATUSES covers allotted + occupied", () => {
    expect([...ACTIVE_ALLOTMENT_STATUSES]).toEqual(["allotted", "occupied"]);
  });
});

describe("Spaces — seat status transitions", () => {
  it("allot marks a seat allotted", () => {
    expect(seatStatusOnAllot()).toBe("allotted");
  });
  it("release frees a seat back to available", () => {
    expect(seatStatusOnRelease()).toBe("available");
  });
});

describe("Spaces — occupancy & availability", () => {
  const seats = [
    { status: "available" }, { status: "available" },
    { status: "allotted" }, { status: "blocked" },
  ];
  it("computes occupancy breakdown", () => {
    const occ = computeOccupancy(seats);
    expect(occ.total).toBe(4);
    expect(occ.available).toBe(2);
    expect(occ.allotted).toBe(1);
    expect(occ.blocked).toBe(1);
    expect(occ.occupancyRate).toBeCloseTo(0.25);
  });
  it("returns 0 occupancy for an empty set", () => {
    const occ = computeOccupancy([]);
    expect(occ.total).toBe(0);
    expect(occ.occupancyRate).toBe(0);
  });
  it("availableSeats filters to available only", () => {
    expect(availableSeats(seats)).toHaveLength(2);
  });
});

describe("Spaces — prorated licence-fee (integer paise)", () => {
  it("returns 0 for zero/negative days", () => {
    expect(computeProratedLicenceFee(30000n, 0)).toBe(0n);
    expect(computeProratedLicenceFee(30000n, -5)).toBe(0n);
  });
  it("returns 0 for zero monthly rate", () => {
    expect(computeProratedLicenceFee(0n, 15)).toBe(0n);
  });
  it("prorates half a month", () => {
    // 30000 * 15 / 30 = 15000
    expect(computeProratedLicenceFee(30000n, 15)).toBe(15000n);
  });
  it("caps occupied days at daysInMonth", () => {
    // 45 days capped to 30 -> full month
    expect(computeProratedLicenceFee(30000n, 45)).toBe(30000n);
  });
});
