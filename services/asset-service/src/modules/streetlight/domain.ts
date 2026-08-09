export const FAULT_TRANSITIONS: Record<string, string[]> = {
  reported:    ["assigned"],
  assigned:    ["in_progress"],
  in_progress: ["resolved"],
  resolved:    ["closed"],
};

export const REQUEST_TRANSITIONS: Record<string, string[]> = {
  submitted: ["surveyed", "rejected"],
  surveyed:  ["approved", "rejected"],
  approved:  ["installed"],
};

export function assertFaultTransition(from: string, to: string): void {
  const allowed = FAULT_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(`Invalid fault status transition: ${from} → ${to}`);
  }
}

export function assertRequestTransition(from: string, to: string): void {
  const allowed = REQUEST_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(`Invalid request status transition: ${from} → ${to}`);
  }
}

let faultSeq = 0;
export function generateFaultNumber(): string {
  faultSeq += 1;
  const ts = Date.now().toString(36).toUpperCase();
  return `SLF-${ts}-${String(faultSeq).padStart(4, "0")}`;
}

let requestSeq = 0;
export function generateRequestNumber(): string {
  requestSeq += 1;
  const ts = Date.now().toString(36).toUpperCase();
  return `SLR-${ts}-${String(requestSeq).padStart(4, "0")}`;
}
