/**
 * Feature: visitor-management, Task 15.4 — modules/vehicle-pass/domain.ts
 *
 * Unit tests covering parking-category resolution, slot allocation
 * (match-by-vehicle-type-and-category, unavailable case), release on
 * checkout, and occupied/available/total counter maintenance.
 *
 * Requirements: 14.1, 14.2, 14.4, 14.5, 14.6
 */
import { describe, expect, it } from "vitest";
import {
  DomainError,
  allocateParkingSlot,
  allocateParkingSlotOrThrow,
  applyAllocation,
  computeSlotCounts,
  getSlotCountsForCategory,
  releaseParkingSlot,
  resolveParkingCategory,
  type ParkingSlotCandidate,
} from "../src/modules/vehicle-pass/domain.js";

function slot(overrides: Partial<ParkingSlotCandidate> = {}): ParkingSlotCandidate {
  return {
    id: "slot-1",
    category: "standard",
    vehicleType: "car",
    occupied: false,
    occupiedBy: null,
    ...overrides,
  };
}

describe("resolveParkingCategory", () => {
  it("two_wheeler always resolves to 'two_wheeler', regardless of visitor category", () => {
    expect(resolveParkingCategory("two_wheeler", "vip")).toBe("two_wheeler");
    expect(resolveParkingCategory("two_wheeler", "standard")).toBe("two_wheeler");
    expect(resolveParkingCategory("two_wheeler", "handicapped")).toBe("two_wheeler");
  });

  it("bus always resolves to 'bus', regardless of visitor category", () => {
    expect(resolveParkingCategory("bus", "vip")).toBe("bus");
    expect(resolveParkingCategory("bus", "standard")).toBe("bus");
  });

  it("car/suv/truck resolve to the visitor category", () => {
    expect(resolveParkingCategory("car", "vip")).toBe("vip");
    expect(resolveParkingCategory("suv", "handicapped")).toBe("handicapped");
    expect(resolveParkingCategory("truck", "standard")).toBe("standard");
  });
});

describe("allocateParkingSlot", () => {
  it("returns the first available slot matching vehicleType + resolved category", () => {
    const slots: ParkingSlotCandidate[] = [
      slot({ id: "s1", category: "standard", vehicleType: "car", occupied: true, occupiedBy: "vp-x" }),
      slot({ id: "s2", category: "vip", vehicleType: "car", occupied: false }),
      slot({ id: "s3", category: "standard", vehicleType: "car", occupied: false }),
    ];

    const result = allocateParkingSlot(slots, "car", "standard");
    expect(result?.id).toBe("s3");
  });

  it("skips occupied slots even when category/vehicleType match", () => {
    const slots: ParkingSlotCandidate[] = [
      slot({ id: "s1", category: "standard", vehicleType: "car", occupied: true, occupiedBy: "vp-x" }),
    ];

    expect(allocateParkingSlot(slots, "car", "standard")).toBeNull();
  });

  it("never allocates a slot of the wrong vehicle type even if the category matches", () => {
    const slots: ParkingSlotCandidate[] = [
      slot({ id: "s1", category: "standard", vehicleType: "suv", occupied: false }),
    ];

    expect(allocateParkingSlot(slots, "car", "standard")).toBeNull();
  });

  it("never allocates a slot of the wrong category even if the vehicle type matches", () => {
    const slots: ParkingSlotCandidate[] = [
      slot({ id: "s1", category: "vip", vehicleType: "car", occupied: false }),
    ];

    expect(allocateParkingSlot(slots, "car", "standard")).toBeNull();
  });

  it("returns null when no slots are available for the requested vehicle type/category (Requirement 14.4)", () => {
    expect(allocateParkingSlot([], "bus", "standard")).toBeNull();
  });
});

describe("allocateParkingSlotOrThrow", () => {
  it("returns the allocated slot when one is available", () => {
    const slots: ParkingSlotCandidate[] = [slot({ id: "s1", category: "bus", vehicleType: "bus" })];
    expect(allocateParkingSlotOrThrow(slots, "bus", "standard").id).toBe("s1");
  });

  it("throws a PARKING_UNAVAILABLE DomainError when no slot is available", () => {
    expect(() => allocateParkingSlotOrThrow([], "bus", "vip")).toThrow(DomainError);
    try {
      allocateParkingSlotOrThrow([], "bus", "vip");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("PARKING_UNAVAILABLE");
    }
  });
});

describe("applyAllocation", () => {
  it("marks an available slot as occupied by the given vehicle pass", () => {
    const available = slot({ id: "s1", occupied: false, occupiedBy: null });
    const result = applyAllocation(available, "vp-123");
    expect(result.occupied).toBe(true);
    expect(result.occupiedBy).toBe("vp-123");
  });

  it("does not mutate the input slot (pure function)", () => {
    const available = slot({ id: "s1", occupied: false, occupiedBy: null });
    applyAllocation(available, "vp-123");
    expect(available.occupied).toBe(false);
    expect(available.occupiedBy).toBeNull();
  });

  it("throws SLOT_ALREADY_OCCUPIED when the slot is already occupied", () => {
    const occupied = slot({ id: "s1", occupied: true, occupiedBy: "vp-existing" });
    expect(() => applyAllocation(occupied, "vp-new")).toThrow(DomainError);
    try {
      applyAllocation(occupied, "vp-new");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("SLOT_ALREADY_OCCUPIED");
    }
  });

  it("throws SLOT_ALREADY_OCCUPIED with an 'unknown' fallback when occupiedBy is null", () => {
    const occupied = slot({ id: "s1", occupied: true, occupiedBy: null });
    try {
      applyAllocation(occupied, "vp-new");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as Error).message).toContain("unknown");
    }
  });
});

describe("releaseParkingSlot", () => {
  it("marks an occupied slot as available and clears occupiedBy (Requirement 14.5)", () => {
    const occupied = slot({ id: "s1", occupied: true, occupiedBy: "vp-123" });
    const result = releaseParkingSlot(occupied);
    expect(result.occupied).toBe(false);
    expect(result.occupiedBy).toBeNull();
  });

  it("does not mutate the input slot (pure function)", () => {
    const occupied = slot({ id: "s1", occupied: true, occupiedBy: "vp-123" });
    releaseParkingSlot(occupied);
    expect(occupied.occupied).toBe(true);
    expect(occupied.occupiedBy).toBe("vp-123");
  });

  it("throws SLOT_NOT_OCCUPIED when releasing an already-available slot", () => {
    const available = slot({ id: "s1", occupied: false, occupiedBy: null });
    expect(() => releaseParkingSlot(available)).toThrow(DomainError);
    try {
      releaseParkingSlot(available);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe("SLOT_NOT_OCCUPIED");
    }
  });
});

describe("computeSlotCounts / getSlotCountsForCategory", () => {
  it("computes occupied/available/total per category, satisfying occupied + available === total (Requirement 14.6)", () => {
    const slots: ParkingSlotCandidate[] = [
      slot({ id: "s1", category: "standard", vehicleType: "car", occupied: true, occupiedBy: "vp1" }),
      slot({ id: "s2", category: "standard", vehicleType: "car", occupied: false }),
      slot({ id: "s3", category: "standard", vehicleType: "car", occupied: false }),
      slot({ id: "s4", category: "vip", vehicleType: "car", occupied: true, occupiedBy: "vp2" }),
      slot({ id: "s5", category: "bus", vehicleType: "bus", occupied: false }),
    ];

    const counts = computeSlotCounts(slots);
    const standard = counts.find((c) => c.category === "standard");
    const vip = counts.find((c) => c.category === "vip");
    const bus = counts.find((c) => c.category === "bus");

    expect(standard).toEqual({ category: "standard", occupied: 1, available: 2, total: 3 });
    expect(vip).toEqual({ category: "vip", occupied: 1, available: 0, total: 1 });
    expect(bus).toEqual({ category: "bus", occupied: 0, available: 1, total: 1 });

    for (const c of counts) {
      expect(c.occupied + c.available).toBe(c.total);
    }
  });

  it("returns an empty array for no slots", () => {
    expect(computeSlotCounts([])).toEqual([]);
  });

  it("getSlotCountsForCategory defaults to all-zero for a category with no slots", () => {
    expect(getSlotCountsForCategory([], "handicapped")).toEqual({
      category: "handicapped",
      occupied: 0,
      available: 0,
      total: 0,
    });
  });

  it("getSlotCountsForCategory returns the matching entry when slots exist", () => {
    const slots: ParkingSlotCandidate[] = [
      slot({ id: "s1", category: "vip", vehicleType: "suv", occupied: true, occupiedBy: "vp1" }),
    ];
    expect(getSlotCountsForCategory(slots, "vip")).toEqual({
      category: "vip",
      occupied: 1,
      available: 0,
      total: 1,
    });
  });
});
