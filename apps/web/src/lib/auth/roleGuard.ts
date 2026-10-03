import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE } from "./config";

interface JwtPayload {
  sub?: string;
  tid?: string;
  roles?: string[];
  exp?: number;
  name?: string;
  email?: string;
}

function decodeJwtPayload(token: string): JwtPayload {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return {};
    const raw = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = raw + "=".repeat((4 - (raw.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8")) as JwtPayload;
  } catch {
    return {};
  }
}

export function getSessionRoles(): string[] {
  const token = cookies().get(COOKIE.ACCESS)?.value;
  if (!token) return [];
  const payload = decodeJwtPayload(token);
  return Array.isArray(payload.roles) ? payload.roles : [];
}

/** The current office (tenant) id from the session, or null when not signed in. */
export function getSessionTenantId(): string | null {
  const token = cookies().get(COOKIE.ACCESS)?.value;
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  return typeof payload.tid === "string" && payload.tid.length > 0 ? payload.tid : null;
}

/** Display name from the session token, or null when not signed in. */
export function getSessionName(): string | null {
  const token = cookies().get(COOKIE.ACCESS)?.value;
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  return typeof payload.name === "string" && payload.name.length > 0 ? payload.name : null;
}

/**
 * The signed-in user's id (JWT `sub`) -- the same value services see as
 * ctx.actorId and stamp into created_by. Used for UI-side maker-checker
 * hints (e.g. GAP-PAYROLL-LOANS-02: hide Disburse on a loan you created);
 * the server remains the authority. Null when not signed in.
 */
export function getSessionUserId(): string | null {
  const token = cookies().get(COOKIE.ACCESS)?.value;
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  return typeof payload.sub === "string" && payload.sub.length > 0 ? payload.sub : null;
}

export function requireAnyRole(allowed: string[], redirectTo = "/dashboard"): void {
  const sessionRoles = getSessionRoles();
  const hasRole = allowed.some((r) => sessionRoles.includes(r));
  if (!hasRole) redirect(redirectTo);
}

/**
 * Roles permitted to create/approve/disburse/revert payroll runs. Mirrors
 * payroll-service's PAYROLL_ROLES (routes.ts) -- single source of truth for
 * every payroll page's admin-only gating (previously duplicated ad hoc per
 * file; see GAP-PAYROLL-RUNS-03).
 */
export const PAYROLL_ADMIN_ROLES = ["payroll_admin", "payroll_officer", "super_admin"];

/**
 * Roles permitted to read payroll run data (list/detail). Mirrors
 * payroll-service's READER_ROLES (routes.ts): PAYROLL_ADMIN_ROLES plus
 * hr_admin/finance_officer -- deliberately NOT "employee" or "manager",
 * which hr/layout.tsx otherwise admits to every /hr/payroll* route. A role
 * outside this list gets a 403 from the API today regardless of what the
 * page renders; gating on this constant shows PermissionDenied instead of
 * an unhandled failed fetch (GAP-PAYROLL-HOME-02/RUNS-04).
 */
export const PAYROLL_READER_ROLES = [...PAYROLL_ADMIN_ROLES, "hr_admin", "finance_officer"];

/**
 * Roles permitted to read the payroll register / comparison / CTC config
 * reports. Mirrors payroll-service world-class-routes.ts's own `ROLES`
 * (payroll_admin, payroll_officer, super_admin, hr_admin) -- narrower than
 * PAYROLL_READER_ROLES: "finance_officer" gets a 403 from those endpoints,
 * and "employee"/"manager" (which hr/layout.tsx admits) must never see
 * department-wide salary totals (GAP-PAYROLL-REGISTER-05 /
 * GAP-PAYROLL-COMPARISON-03).
 */
export const PAYROLL_REPORT_ROLES = [...PAYROLL_ADMIN_ROLES, "hr_admin"];

/**
 * Roles permitted to approve/reject a cycle count. Mirrors inventory-service's
 * APPROVE_ROLES in modules/cycle-count/routes.ts (GAP-INVENTORY-CYCLE-COUNTS-DETAIL-02);
 * the server remains the authority (it also enforces maker != checker).
 */
export const INVENTORY_CYCLE_COUNT_APPROVE_ROLES = ["inventory_manager", "inventory_admin", "super_admin"];

/**
 * Roles permitted to create inventory master data (bins, items). Mirrors
 * inventory-service's WRITE_ROLES in modules/items/routes.ts
 * (GAP-INVENTORY-BINS-03 / GAP-INVENTORY-ITEMS-03); the service stays the
 * authority, this only stops offering a control that is guaranteed to 403.
 */
export const INVENTORY_WRITE_ROLES = ["inventory_user", "inventory_manager", "inventory_admin", "store_keeper", "super_admin"];

/**
 * Roles permitted to activate/deactivate a bin. Mirrors inventory-service's
 * BIN_ADMIN_ROLES in modules/items/routes.ts (GAP-INVENTORY-BINS-03); the
 * service stays the authority.
 */
export const INVENTORY_BIN_MANAGE_ROLES = ["inventory_manager", "inventory_admin", "super_admin"];

/**
 * Roles permitted to change tenant inventory policy (QC maker-checker).
 * Mirrors inventory-service's SETTINGS_ROLES (GAP-INVENTORY-GOODS-RETURNS-DETAIL-04).
 */
export const INVENTORY_SETTINGS_ROLES = ["inventory_admin", "super_admin"];
