export const ALLOTMENT_TYPES = ["draw", "auction", "committee", "direct"] as const;
export type AllotmentType = (typeof ALLOTMENT_TYPES)[number];

export const ALLOTMENT_STATUSES = [
  "applied",
  "selected",
  "agreement_signed",
  "active",
  "transferred",
  "cancelled",
  "evicted",
] as const;
export type AllotmentStatus = (typeof ALLOTMENT_STATUSES)[number];

const VALID_TRANSITIONS: Record<string, AllotmentStatus[]> = {
  applied: ["selected", "cancelled"],
  selected: ["agreement_signed", "cancelled"],
  agreement_signed: ["active", "cancelled"],
  active: ["transferred", "cancelled", "evicted"],
  transferred: [],
  cancelled: [],
  evicted: [],
};

export function canTransition(from: string, to: AllotmentStatus): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

export function generateAllotmentNumber(tenantShortCode: string, sequence: number): string {
  const year = new Date().getUTCFullYear();
  return `MKT/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}
