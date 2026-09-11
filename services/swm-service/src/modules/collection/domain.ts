export type CollectionStatus = "requested" | "scheduled" | "collected" | "cancelled";
export type WasteType = "construction_debris" | "garden_waste" | "e_waste" | "hazardous" | "bulky_item";
export type FieldTaskStatus = "assigned" | "in_progress" | "completed";

const COLLECTION_TRANSITIONS: Record<CollectionStatus, CollectionStatus[]> = {
  requested: ["scheduled", "cancelled"],
  scheduled: ["collected", "cancelled"],
  collected: [],
  cancelled: [],
};

export function validateCollectionTransition(from: CollectionStatus, to: CollectionStatus): string | null {
  const allowed = COLLECTION_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) return `invalid transition: ${from} → ${to}`;
  return null;
}

const TASK_TRANSITIONS: Record<FieldTaskStatus, FieldTaskStatus[]> = {
  assigned: ["in_progress"],
  in_progress: ["completed"],
  completed: [],
};

export function validateTaskTransition(from: FieldTaskStatus, to: FieldTaskStatus): string | null {
  const allowed = TASK_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) return `invalid transition: ${from} → ${to}`;
  return null;
}

// TX-008: fee must be server-derived, never accepted from the client (a
// collection-request body used to carry feeMinor straight from swm_user
// input through to persistence). Mirrors the calculateFeeMinor() pattern
// used for every other priced module in this codebase (e.g.
// crematorium-service bookings/domain.ts, asset-service
// water-connections/domain.ts): a fixed rate table keyed on the one
// legitimate pricing input (wasteType), called from the consumer — never
// from the route handler, and the client-submitted value is ignored.
const FEE_TABLE: Record<WasteType, number> = {
  construction_debris: 500000, // Rs 5,000
  garden_waste: 20000, // Rs 200
  e_waste: 30000, // Rs 300
  hazardous: 1000000, // Rs 10,000
  bulky_item: 50000, // Rs 500
};

export function calculateFeeMinor(wasteType: WasteType): number {
  return FEE_TABLE[wasteType] ?? 50000;
}
