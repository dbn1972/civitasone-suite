type PillVariant = "good" | "warn" | "mut" | "bad" | "info";

const STATUS_MAP: Record<string, PillVariant> = {
  active: "good",
  approved: "good",
  paid: "good",
  completed: "good",
  passed: "good",
  cleared: "good",
  open: "good",
  signed: "good",
  pending: "warn",
  "under review": "warn",
  "in progress": "warn",
  submitted: "warn",
  review: "warn",
  draft: "mut",
  inactive: "mut",
  closed: "mut",
  confirmed: "good",
  probation: "warn",
  retired: "mut",
  resigned: "mut",
  terminated: "bad",
  rejected: "bad",
  overdue: "bad",
  breached: "bad",
  failed: "bad",
  blocked: "bad",
  expired: "bad",
  success: "good",
  failure: "bad",
  connected: "good",
  unconfigured: "mut",
  "low stock": "bad",
  archived: "mut",
};
// Deliberately NOT added: a generic "flagged" key. tenant-admin/security/SecurityTable.tsx
// has its own inline outcome->variant mapping that fails closed to "bad" for any
// outcome it doesn't recognize (outcome is an open `string`, not a closed enum) --
// an appropriate default for a security-events table that this shared component's
// neutral "info" fallback would weaken, so that table is intentionally left
// un-consolidated (see UX-009 PR description).

interface StatusPillProps {
  status: string;
  label?: string;
}

export function StatusPill({ status, label }: StatusPillProps) {
  const variant: PillVariant = STATUS_MAP[status.toLowerCase()] ?? "info";
  return <span className={`pill ${variant}`}>{label ?? status}</span>;
}
