import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE } from "@/lib/auth/config";

/** Decode a JWT payload without verifying — used only to namespace the local
 * cache (the cookie is already trusted; this is not an auth decision). */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const json = Buffer.from(parts[1]!.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function GET() {
  const at = cookies().get(COOKIE.ACCESS)?.value;
  if (!at) return NextResponse.json({ authenticated: false });

  const claims = decodeJwtPayload(at);
  const tenantId = (claims?.tid as string) ?? (claims?.tenantId as string) ?? "";
  const userId = (claims?.sub as string) ?? "";

  // Display-only hints for the signed-in user's own UI (never an authorisation decision -- the
  // services re-check every role): which buttons to offer, and maker-checker "you created this" hints.
  const roles = Array.isArray(claims?.roles) ? (claims.roles as unknown[]).filter((r): r is string => typeof r === "string") : [];

  // tenantId + userId namespace the per-user encrypted IndexedDB store (01-T5).
  return NextResponse.json({ authenticated: true, tenantId, userId, roles });
}
