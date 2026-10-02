import { humanizeStatus } from "@/lib/formatters";

export type PillVariant = "good" | "warn" | "mut" | "bad" | "info";

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
  // GAP-HR-SERVICE-BOOK-01: service book entries are "attested" (competent-
  // authority sign-off, immutable) or "recorded" (not yet attested); neither
  // key existed here before, so both fell back to the generic "info" tone.
  attested: "good",
  recorded: "warn",
  // GAP-HR-RETIREMENT-03: "initiated" (below, pre-existing) already covers
  // hrms_separations.status's default value with the "warn" tone this GAP
  // needed -- confirmed before assuming a fix was required here.
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

  // --- GAP SF-04 (additive): every key below was verified against a real call
  // site under apps/web/src/app/(app)/hr/** (incl. payroll/** and
  // recruitment/**, which share hr/layout.tsx) -- either a direct
  // `<StatusPill status={...}/>` usage or a DataTable `cellType: "status"`
  // column -- cross-checked against the hrms-service enum or DB CHECK
  // constraint that actually produces the value. All keys are written in
  // normalizeStatusKey()'s canonical space-separated lowercase form (real API
  // values are snake_case, e.g. "pending_approval"; see that function).
  // Status words the gap catalog mentioned but that do not appear anywhere in
  // the real tree today -- "on_hold", "released", "delayed" -- were checked
  // for and deliberately left out; add them if/when a real caller uses them.

  // Attendance (services/hrms-service/src/modules/attendance/validators.ts)
  present: "good",
  absent: "bad",
  "half day": "warn", // partial day; usually needs a regularisation follow-up
  "on leave": "info", // planned/approved absence, not actionable
  holiday: "info",

  // Employee lifecycle (services/hrms-service/.../employee/status.ts EMPLOYEE_STATUSES)
  suspended: "bad",
  deputation: "info", // the *employee's* own status while posted elsewhere
  separated: "mut",
  "no show": "bad",

  // Deputation record itself (hr/deputation). Real backend enum is
  // active|repatriated|cancelled (deputation/schema.ts) -- "active" already
  // maps above, "cancelled" already maps below. GAP-HR-DEPUTATION-01 found
  // "repatriated" (the actual close-out status) had no entry at all, so it
  // fell through to the "info" default; "recalled" never existed on the
  // backend and is left mapped (harmless) only because another caller may
  // still reference it.
  recalled: "warn",
  repatriated: "mut",

  // Disciplinary case lifecycle (migrations 0022 + 0029, hrms_disc_cases_status_check)
  opened: "warn",
  "charge memo issued": "warn",
  "inquiry appointed": "warn",
  "finding recorded": "warn",
  "pending approval": "warn",
  "penalty imposed": "bad",
  "appeal filed": "warn",
  "appeal decided": "info",
  dropped: "mut",

  // Grievance / ICC (POSH) case intake
  registered: "warn",
  "under inquiry": "warn",
  inquiry: "warn",
  disposed: "mut",

  // RTI
  filed: "warn",
  assigned: "warn",
  responded: "good",

  // Medical claims / payroll settlement -- settled/credited/disbursed share the
  // "money actually moved, favourably" tone as the existing paid/cleared keys
  settled: "good",
  credited: "good",
  disbursed: "good",
  computed: "warn",
  processing: "warn",
  // payroll.disbursement_transfers (GAP-PAYROLL-DISBURSEMENT-TRANSFERS):
  // "sent" = in a generated bank file, outcome not yet known; "returned" =
  // the bank bounced the credit (NACH return), money did not land.
  sent: "warn",
  returned: "bad",
  finalized: "good",
  applied: "warn",
  "late filed": "warn",

  // Recruitment pipeline / job-opening lifecycle
  scheduled: "info",
  cancelled: "bad",
  validated: "good",
  selected: "good",
  offered: "good",
  hired: "good",

  // Transfer / promotion / apar
  initiated: "warn",
  "order issued": "warn",
  relieved: "good",
  disputed: "bad",
  accepted: "good", // apar record accepted by the accepting authority -- final positive sign-off

  // Training (queries.ts training/routes.ts; nominated/waitlisted/attended
  // are real hrms_nominations.status values -- see training/schema.ts and
  // training-admin/routes.ts's approve/reject CHECK-constraint comments,
  // GAP-HR-TRAINING-NOMINATIONS-01)
  upcoming: "info",
  nominated: "warn",
  waitlisted: "info",
  attended: "info",

  // Leave-routing engine failure (a technical failure, not a human rejection)
  "routing failed": "bad",

  // TDS returns overview (GAP-PAYROLL-RETURNS-01/02): "reconciled" with
  // TRACES is NOT "filed"; a quarter that failed to load is unknown, not
  // "pending". PAN status on deductee rows (GAP-PAYROLL-RETURNS-05).
  reconciled: "good",
  unreconciled: "warn",
  "not loaded": "mut",
  "pan ok": "good",
  "pan missing": "bad",

  // Cheque / DD register (finance-service treasury: issued -> presented ->
  // cleared | bounced | cancelled; GAP-FINANCE-TREASURY-CHEQUES-01). A bounced
  // instrument is the exception the register exists to surface, so it must not
  // share the neutral fallback with a merely presented one. "cleared" (good)
  // and "cancelled" (bad, recruitment-shared) already map above.
  bounced: "bad",
  stale: "bad",
  presented: "warn",
  issued: "info", // explicit: this is the neutral starting state, not an unmapped word

  // Platform admin lists (GAP-ADMIN-ENTITLEMENTS-06, GAP-ADMIN-GATEWAYS-04/05): only
  // unambiguous words. "revoked" entitlement; communication-gateway health. An
  // outage must read red, a degraded gateway amber, a standby one neutral --
  // none of these used to have a key, so all fell back to the blue "info" pill.
  revoked: "bad",
  degraded: "warn",
  down: "bad",
  standby: "mut",
};
// Deliberately NOT added: a generic "flagged" key. tenant-admin/security/SecurityTable.tsx
// has its own inline outcome->variant mapping that fails closed to "bad" for any
// outcome it doesn't recognize (outcome is an open `string`, not a closed enum) --
// an appropriate default for a security-events table that this shared component's
// neutral "info" fallback would weaken, so that table is intentionally left
// un-consolidated (see UX-009 PR description).

// Real status values are inconsistent about word separators depending on which
// API/module produced them (snake_case "pending_approval" from most backend
// enums, occasional camelCase, hyphens in a couple of hand-written literals) --
// STATUS_MAP itself is keyed on a single canonical space-separated form (matching
// its pre-existing multi-word keys like "in progress"), so every caller's status
// prop is normalized the same way before lookup, regardless of which separator
// style it happened to arrive in.
function normalizeStatusKey(status: string): string {
  return status
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase word boundary -> space
    .replace(/[_-]+/g, " ") // underscores/hyphens -> space
    .replace(/\s+/g, " ") // collapse repeats
    .trim()
    .toLowerCase();
}

interface StatusPillProps {
  status: string;
  label?: string;
  /**
   * Explicit tone that overrides the global STATUS_MAP -- for registers where a
   * word means something different from the app-wide default (e.g. an "open"
   * audit para is unresolved/red, not green; GAP-FINANCE-AUDIT-PARAS-01).
   */
  variant?: PillVariant;
}

export function StatusPill({ status, label, variant: variantOverride }: StatusPillProps) {
  const variant: PillVariant = variantOverride ?? STATUS_MAP[normalizeStatusKey(status)] ?? "info";
  // Bug fix: this used to fall back to the raw `status` value itself
  // ("pending", "active", "na", ...) whenever a caller didn't pass an
  // explicit label -- a real database enum value shown verbatim, unstyled
  // lowercase text, instead of a properly capitalized display label. Most
  // callers across the app never pass label at all and relied on this
  // default. Now falls back to a humanized version of status instead of the
  // raw string; callers that need exact custom wording still can via label.
  return <span className={`pill ${variant}`}>{label ?? humanizeStatus(status)}</span>;
}
