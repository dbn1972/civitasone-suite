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

// TX-008: fee must be server-derived, never accepted from the client
// (register/update bodies used to carry feeMinor straight from swm_admin
// input through to persistence). Mirrors the calculateFeeMinor() rate-table
// pattern used elsewhere in this codebase (e.g. asset-service
// water-connections/domain.ts FEE_TABLE keyed on connectionType+pipeSize):
// a fixed table keyed on the legitimate pricing inputs (generatorType,
// category), called from the consumer — never from the route handler.
const FEE_TABLE: Record<GeneratorType, Record<WasteCategory, bigint>> = {
  hotel: { wet: 1000000n, dry: 800000n, mixed: 1200000n },
  restaurant: { wet: 700000n, dry: 500000n, mixed: 900000n },
  mall: { wet: 1500000n, dry: 1200000n, mixed: 1800000n },
  hospital: { wet: 2000000n, dry: 1800000n, mixed: 2500000n },
  market: { wet: 600000n, dry: 400000n, mixed: 800000n },
};

export function calculateFeeMinor(generatorType: GeneratorType, category: WasteCategory): bigint {
  return FEE_TABLE[generatorType]?.[category] ?? 500000n;
}
