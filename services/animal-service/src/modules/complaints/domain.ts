export const COMPLAINT_STATUSES = [
  "reported",
  "assigned",
  "dispatched",
  "action_taken",
  "closed",
] as const;

export type ComplaintStatus = (typeof COMPLAINT_STATUSES)[number];

const VALID_TRANSITIONS: Record<string, ComplaintStatus[]> = {
  reported: ["assigned"],
  assigned: ["dispatched"],
  dispatched: ["action_taken"],
  action_taken: ["closed"],
  closed: [],
};

export function canTransition(from: string, to: ComplaintStatus): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

export const ANIMAL_TYPES = ["dog", "cattle", "cat", "monkey", "pig", "snake", "other"] as const;
export const COMPLAINT_TYPES = ["stray", "injured", "dangerous", "dead", "nuisance", "bite"] as const;
export const SEVERITY_LEVELS = ["low", "medium", "high", "critical"] as const;

export function generateComplaintNumber(tenantShortCode: string, sequence: number): string {
  const year = new Date().getUTCFullYear();
  return `ANML/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}

export function routeComplaint(animalType: string, severity: string): string {
  if (severity === "critical" || animalType === "snake") return "veterinary";
  if (["dangerous", "bite"].includes(animalType)) return "animal_control";
  if (animalType === "cattle") return "cattle_squad";
  return "field_team";
}
