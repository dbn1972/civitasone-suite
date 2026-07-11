/**
 * visitor-service: vehicle-pass — pure domain logic.
 *
 * Owns:
 *   - Parking-slot allocation by vehicle type + visitor category
 *     (Requirement 14.2). `visitor.parking_slots.category` is a single
 *     column whose value is EITHER a vehicle-shape category
 *     (`two_wheeler` | `bus`, for vehicle types with no visitor-category
 *     distinction) OR a visitor-category value (`vip` | `standard` |
 *     `handicapped`, for `car` | `suv` | `truck`, where parking is
 *     differentiated by who the visitor is rather than the vehicle shape).
 *     `resolveParkingCategory` encodes this mapping so allocation always
 *     targets exactly one category per (vehicleType, visitorCategory) pair.
 *   - Release on checkout (Requirement 14.5): frees the slot previously
 *     allocated to a Vehicle_Pass.
 *   - Occupied/available counter maintenance (Requirement 14.6; Property
 *     22): `computeSlotCounts` derives per-category occupied/available/total
 *     counts directly from the current slot list, so the invariant
 *     `occupied + available === total` holds by construction — there is no
 *     separate counter that could drift out of sync.
 *
 * This module performs no I/O. Callers (consumer.ts) load candidate slots
 * via repo.ts, call `allocateParkingSlot`/`releaseParkingSlot` to decide the
 * mutation, and persist the result themselves.
 */

export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

// ── Types ────────────────────────────────────────────────────────────────

/** `visitor.vehicle_passes.vehicle_type` per migration 0004. */
export type VehicleType = "two_wheeler" | "car" | "suv" | "bus" | "truck";

/**
 * Visitor category as used for parking differentiation (Requirement 14.2).
 * A narrower set than the full visitor-category domain elsewhere in the
 * system (e.g. `vip` module) because only these three affect parking
 * allocation.
 */
export type VisitorCategory = "vip" | "standard" | "handicapped";

/** `visitor.parking_slots.category` per migration 0001. */
export type ParkingCategory = "vip" | "standard" | "handicapped" | "two_wheeler" | "bus";

/**
 * A parking slot as seen by domain logic — a plain projection of the
 * `visitor.parking_slots` row, independent of Drizzle row shape so this
 * module stays I/O-free and easily testable.
 */
export interface ParkingSlotCandidate {
  id: string;
  category: ParkingCategory;
  vehicleType: VehicleType;
  occupied: boolean;
  occupiedBy: string | null;
}

// ── Category Resolution ─────────────────────────────────────────────────

/**
 * Resolves the single `ParkingCategory` a given (vehicleType, visitorCategory)
 * pair must be allocated against (Requirement 14.2).
 *
 * `two_wheeler` and `bus` vehicles always park in their own vehicle-shape
 * category regardless of visitor category (there is no "VIP two-wheeler
 * slot" or "handicapped bus slot" in the slot taxonomy). `car`, `suv`, and
 * `truck` vehicles park according to the visitor's category (`vip`,
 * `standard`, or `handicapped`).
 */
export function resolveParkingCategory(
  vehicleType: VehicleType,
  visitorCategory: VisitorCategory,
): ParkingCategory {
  if (vehicleType === "two_wheeler" || vehicleType === "bus") {
    return vehicleType;
  }
  return visitorCategory;
}

// ── Allocation ───────────────────────────────────────────────────────────

/**
 * Allocates a parking slot for the given vehicle type + visitor category
 * (Requirement 14.2; Property 22). Returns the first available (not
 * occupied) slot among `slots` whose `vehicleType` and `category` both match
 * the resolved target category — i.e. the allocated slot ALWAYS matches the
 * requested vehicle type and category, satisfying Property 22's matching
 * clause by construction.
 *
 * Returns `null` when no matching slot is available (Requirement 14.4 —
 * callers must notify the visitor in advance and suggest alternatives; see
 * `allocateParkingSlotOrThrow` for the `PARKING_UNAVAILABLE` (422) mapping).
 *
 * Pure and deterministic: iterates `slots` in the order given by the
 * caller (repo.ts is expected to query `ORDER BY slot_number ASC` for
 * stable, predictable allocation), performs no mutation, and does not
 * consult the current date/time.
 */
export function allocateParkingSlot(
  slots: readonly ParkingSlotCandidate[],
  vehicleType: VehicleType,
  visitorCategory: VisitorCategory,
): ParkingSlotCandidate | null {
  const targetCategory = resolveParkingCategory(vehicleType, visitorCategory);

  for (const slot of slots) {
    if (!slot.occupied && slot.category === targetCategory && slot.vehicleType === vehicleType) {
      return slot;
    }
  }
  return null;
}

/**
 * Same as `allocateParkingSlot`, but throws `PARKING_UNAVAILABLE` (mapped to
 * HTTP 422 per the design's error-code table) instead of returning `null`,
 * for callers that want to fail fast at the route/consumer boundary.
 */
export function allocateParkingSlotOrThrow(
  slots: readonly ParkingSlotCandidate[],
  vehicleType: VehicleType,
  visitorCategory: VisitorCategory,
): ParkingSlotCandidate {
  const slot = allocateParkingSlot(slots, vehicleType, visitorCategory);
  if (slot === null) {
    throw new DomainError(
      "PARKING_UNAVAILABLE",
      `no available parking slot for vehicleType=${vehicleType}, visitorCategory=${visitorCategory}`,
    );
  }
  return slot;
}

/**
 * Produces the persisted-row update for marking `slot` as occupied by
 * `vehiclePassId` (Requirement 14.2). Throws `SLOT_ALREADY_OCCUPIED` if the
 * slot is already occupied — allocation must always start from an
 * available slot (see `allocateParkingSlot`), so this guards against a
 * caller applying the mutation to a stale/incorrect slot.
 */
export function applyAllocation(
  slot: ParkingSlotCandidate,
  vehiclePassId: string,
): ParkingSlotCandidate {
  if (slot.occupied) {
    throw new DomainError(
      "SLOT_ALREADY_OCCUPIED",
      `parking slot ${slot.id} is already occupied (by ${slot.occupiedBy ?? "unknown"})`,
    );
  }
  return { ...slot, occupied: true, occupiedBy: vehiclePassId };
}

// ── Release on Checkout ──────────────────────────────────────────────────

/**
 * Produces the persisted-row update for releasing `slot` on visitor
 * checkout (Requirement 14.5; Property 22). The slot is marked available
 * (`occupied: false`, `occupiedBy: null`) so the next allocation for its
 * category can reuse it. Throws `SLOT_NOT_OCCUPIED` if the slot is not
 * currently occupied — release is only valid for a currently-allocated
 * slot.
 */
export function releaseParkingSlot(slot: ParkingSlotCandidate): ParkingSlotCandidate {
  if (!slot.occupied) {
    throw new DomainError("SLOT_NOT_OCCUPIED", `parking slot ${slot.id} is not currently occupied`);
  }
  return { ...slot, occupied: false, occupiedBy: null };
}

// ── Occupied/Available Counter Maintenance ────────────────────────────────

export interface ParkingSlotCounts {
  category: ParkingCategory;
  occupied: number;
  available: number;
  total: number;
}

/**
 * Computes real-time occupied/available/total counts per category
 * (Requirement 14.6; Property 22). Because `occupied` and `available` are
 * both derived by partitioning the same `slots` list, `occupied +
 * available === total` holds for every category unconditionally — there is
 * no separate counter to fall out of sync with the underlying slot rows.
 *
 * Categories with zero slots are omitted (there is nothing to count).
 * Callers that need every known category represented (even with zero
 * slots) should seed the result with `total: 0` rows for those categories
 * separately.
 */
export function computeSlotCounts(slots: readonly ParkingSlotCandidate[]): ParkingSlotCounts[] {
  const byCategory = new Map<ParkingCategory, ParkingSlotCounts>();

  for (const slot of slots) {
    const entry = byCategory.get(slot.category) ?? {
      category: slot.category,
      occupied: 0,
      available: 0,
      total: 0,
    };

    entry.total += 1;
    if (slot.occupied) {
      entry.occupied += 1;
    } else {
      entry.available += 1;
    }

    byCategory.set(slot.category, entry);
  }

  return [...byCategory.values()];
}

/**
 * Looks up the counts for a single category, defaulting to all-zero when
 * the category has no slots at all. Convenience wrapper over
 * `computeSlotCounts` for callers (e.g. routes.ts) that only need one
 * category's counts.
 */
export function getSlotCountsForCategory(
  slots: readonly ParkingSlotCandidate[],
  category: ParkingCategory,
): ParkingSlotCounts {
  const counts = computeSlotCounts(slots).find((c) => c.category === category);
  return counts ?? { category, occupied: 0, available: 0, total: 0 };
}
