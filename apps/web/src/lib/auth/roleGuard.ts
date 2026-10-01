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
