export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

// P1-6: single source of truth for the observation lifecycle vocabulary.
// Internal (DB) statuses — the full set the consumer may write.
export const OBSERVATION_STATUSES = [
  "open",
  "replied",
  "replied_rejected",
  "para_drafted",
  "compliance_pending",
  "partially_closed",
  "closed",
] as const;
export type ObservationStatus = (typeof OBSERVATION_STATUSES)[number];

// P1-6: lifecycle transition graph (closure paths added).
const VALID_TRANSITIONS: Record<ObservationStatus, ObservationStatus[]> = {
  open:               ["replied", "para_drafted", "closed"],
  replied:            ["compliance_pending", "replied_rejected"],
  replied_rejected:   ["replied"],
  para_drafted:       ["compliance_pending", "closed"],
  compliance_pending: ["partially_closed", "closed"],
  partially_closed:   ["closed", "compliance_pending"],
  closed:             [],
};

export function assertCanTransition(from: string, to: ObservationStatus): void {
  const f = from as ObservationStatus;
  if (!VALID_TRANSITIONS[f]?.includes(to)) {
    throw new DomainError("INVALID_TRANSITION", `cannot transition observation from '${from}' to '${to}'`);
  }
}

export function isClosable(status: string): boolean {
  const f = status as ObservationStatus;
  return (VALID_TRANSITIONS[f] ?? []).includes("closed");
}

export function assertCanDraftPara(status: string): void {
  if (status !== "open") {
    throw new DomainError("INVALID_STATUS", `only open observations can be drafted to para, got '${status}'`);
  }
}

// P1-6: read-model vocabulary (must match @civitasone/schemas/web AuditObservationSummarySchema).
// Internal statuses without a 1:1 read-model value are folded to the nearest public state.
export function toReadModelStatus(status: string): "open" | "replied" | "partially_closed" | "closed" | "compliance_pending" {
  switch (status) {
    case "replied": return "replied";
    case "replied_rejected": return "replied";
    case "partially_closed": return "partially_closed";
    case "closed": return "closed";
    case "compliance_pending": return "compliance_pending";
    case "para_drafted": return "compliance_pending";
    default: return "open";
  }
}
