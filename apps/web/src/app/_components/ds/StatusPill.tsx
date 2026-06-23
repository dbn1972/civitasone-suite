type PillVariant = "good" | "warn" | "mut" | "bad" | "info";

const STATUS_MAP: Record<string, PillVariant> = {
  active: "good",
  approved: "good",
  paid: "good",
  completed: "good",
  passed: "good",
  cleared: "good",
  open: "good",
  pending: "warn",
  "under review": "warn",
  "in progress": "warn",
  submitted: "warn",
  review: "warn",
  draft: "mut",
  inactive: "mut",
  closed: "mut",
  rejected: "bad",
  overdue: "bad",
  breached: "bad",
  failed: "bad",
  blocked: "bad",
};

interface StatusPillProps {
  status: string;
  label?: string;
}

export function StatusPill({ status, label }: StatusPillProps) {
  const variant: PillVariant = STATUS_MAP[status.toLowerCase()] ?? "info";
  return <span className={`pill ${variant}`}>{label ?? status}</span>;
}
