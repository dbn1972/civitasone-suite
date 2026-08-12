const APPLICATION_STATUSES = ["draft", "submitted", "under_review", "feasibility_check", "approved", "rejected", "installed", "activated", "withdrawn"] as const;
type ApplicationStatus = typeof APPLICATION_STATUSES[number];

const CONNECTION_STATUSES = ["active", "suspended", "disconnected", "transferred"] as const;

export const VALID_TRANSITIONS: Record<string, string[]> = {
  draft:             ["submitted", "withdrawn"],
  submitted:         ["under_review", "withdrawn"],
  under_review:      ["feasibility_check", "rejected"],
  feasibility_check: ["approved", "rejected"],
  approved:          ["installed"],
  installed:         ["activated"],
};

export function assertTransition(from: string, to: string): void {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new Error(`Invalid status transition: ${from} → ${to}`);
  }
}

let appSeq = 0;
export function generateApplicationNumber(): string {
  appSeq += 1;
  const ts = Date.now().toString(36).toUpperCase();
  return `WA-${ts}-${String(appSeq).padStart(4, "0")}`;
}

let connSeq = 0;
export function generateConnectionNumber(): string {
  connSeq += 1;
  const ts = Date.now().toString(36).toUpperCase();
  return `WC-${ts}-${String(connSeq).padStart(4, "0")}`;
}

const FEE_TABLE: Record<string, Record<string, bigint>> = {
  domestic:       { "15mm": 2500_00n, "20mm": 3500_00n, "25mm": 5000_00n },
  commercial:     { "15mm": 5000_00n, "20mm": 7500_00n, "25mm": 10000_00n },
  industrial:     { "15mm": 10000_00n, "20mm": 15000_00n, "25mm": 20000_00n },
  institutional:  { "15mm": 3000_00n, "20mm": 4500_00n, "25mm": 6000_00n },
};

export function calculateFeeMinor(connectionType: string, pipeSize: string): bigint {
  return FEE_TABLE[connectionType]?.[pipeSize] ?? 5000_00n;
}
