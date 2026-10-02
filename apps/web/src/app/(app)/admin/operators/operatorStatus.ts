// GAP-ADMIN-OPERATORS-02: account state must come from the operator's own
// `status`, never inferred from the 2FA column. A row with 2FA "Disabled" and
// no `status` used to be counted as Suspended.
export type OperatorAccountStatus = "active" | "suspended" | "unknown";

const SUSPENDED = new Set(["suspended", "disabled", "locked", "deactivated"]);

export function operatorAccountStatus(o: Record<string, unknown>): OperatorAccountStatus {
  const raw = typeof o.status === "string" ? o.status.trim().toLowerCase() : "";
  if (raw === "active") return "active";
  if (SUSPENDED.has(raw)) return "suspended";
  return "unknown";
}

export function summariseOperators(operators: Record<string, unknown>[]): {
  active: number | null;
  suspended: number | null;
  unknown: number;
} {
  let active = 0;
  let suspended = 0;
  let unknown = 0;
  for (const o of operators) {
    const s = operatorAccountStatus(o);
    if (s === "active") active++;
    else if (s === "suspended") suspended++;
    else unknown++;
  }
  // No row carries a usable status: report "not known", never a guessed 0/N.
  if (operators.length > 0 && unknown === operators.length) return { active: null, suspended: null, unknown };
  return { active, suspended, unknown };
}
