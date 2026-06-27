import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE } from "./config";

interface JwtPayload {
  sub?: string;
  tid?: string;
  roles?: string[];
  exp?: number;
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

export function requireAnyRole(allowed: string[], redirectTo = "/dashboard"): void {
  const sessionRoles = getSessionRoles();
  const hasRole = allowed.some((r) => sessionRoles.includes(r));
  if (!hasRole) redirect(redirectTo);
}
