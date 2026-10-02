import { normStatus, str } from "../_components/status";
import { summariseOperators } from "./operatorStatus";
import type { PillVariant } from "@/app/_components/ds/StatusPill";

/** GET /v1/admin/operators rows. `permissions` may arrive as a list or a free-text string. */
export type OperatorRow = {
  name: string;
  role: string;
  lastLogin: string;
  status: string;
  twoFaStatus: string;
  permissions: string | string[];
};

export function toOperatorRows(raw: Record<string, unknown>[]): OperatorRow[] {
  return raw.map((r) => ({
    name: str(r.name),
    role: str(r.role),
    lastLogin: str(r.lastLogin),
    status: str(r.status),
    twoFaStatus: str(r.twoFaStatus),
    permissions: Array.isArray(r.permissions) ? r.permissions.map((p) => str(p)) : str(r.permissions),
  }));
}

/** GAP-ADMIN-OPERATORS-05: split a permissions value into individual chips. */
export function permissionList(p: string | string[]): string[] {
  const parts = Array.isArray(p) ? p : p.split(/[,;]/);
  return parts.map((x) => x.trim()).filter(Boolean);
}

export type TwoFaState = "enabled" | "disabled" | "unknown";

const TWO_FA_OFF = new Set(["disabled", "off", "not enabled", "none", "false", "inactive"]);

/**
 * Only an explicit value is a statement of posture. An empty/missing field (the
 * route is unserved, or the row lacks it) is "unknown" -- never "not enabled".
 */
export function twoFaState(v: string): TwoFaState {
  const s = normStatus(v);
  if (s === "enabled") return "enabled";
  if (TWO_FA_OFF.has(s)) return "disabled";
  return "unknown";
}

export function isTwoFaEnabled(v: string): boolean {
  return twoFaState(v) === "enabled";
}

/**
 * GAP-ADMIN-OPERATORS-07: 2FA is its own column with its own explicit mapping --
 * enabled = good, explicit off = warn "Not enabled", anything else = neutral
 * "Unknown" -- so it never clashes with account-status semantics and never
 * asserts a security posture the data does not state.
 */
export function twoFaTone(v: string): { variant: PillVariant; label: string } {
  switch (twoFaState(v)) {
    case "enabled": return { variant: "good", label: "Enabled" };
    case "disabled": return { variant: "warn", label: "Not enabled" };
    default: return { variant: "mut", label: "Unknown" };
  }
}

export function operatorStats(rows: OperatorRow[]) {
  const { active, suspended, unknown } = summariseOperators(rows);
  // No row states a 2FA value at all: report "not known" (null -> em dash), not a guessed 0.
  const twoFa = rows.some((o) => twoFaState(o.twoFaStatus) !== "unknown") || rows.length === 0
    ? rows.filter((o) => isTwoFaEnabled(o.twoFaStatus)).length
    : null;
  return { total: rows.length, active, suspended, unknown, twoFa };
}
