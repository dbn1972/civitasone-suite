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
