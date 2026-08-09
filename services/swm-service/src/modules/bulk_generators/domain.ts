export type GeneratorStatus = "registered" | "active" | "suspended" | "cancelled";
export type GeneratorType = "hotel" | "restaurant" | "mall" | "hospital" | "market";
export type WasteCategory = "wet" | "dry" | "mixed";

const TRANSITIONS: Record<GeneratorStatus, GeneratorStatus[]> = {
  registered: ["active", "cancelled"],
  active: ["suspended", "cancelled"],
  suspended: ["active", "cancelled"],
  cancelled: [],
};

export function validateGeneratorTransition(from: GeneratorStatus, to: GeneratorStatus): string | null {
  const allowed = TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) return `invalid transition: ${from} → ${to}`;
  return null;
}
