import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE } from "@/lib/auth/config";
import { describeSessionTimes } from "@/lib/auth/sessionCookies";

/**
 * A11Y-01 (WCAG 2.2.1): session timing for the session-expiry warning.
 *
 *  - GET  reports the current session's timing (no refresh).
 *  - POST extends the session. The refresh itself is done by middleware.ts
 *    BEFORE this handler runs (single-flight, see lib/auth/tokenRefresh.ts);
 *    when it succeeds the middleware forwards the new cookies to this request,
 *    so this handler simply reports the renewed timing. A failed refresh never
 *    reaches here: the middleware answers 401 SESSION_EXPIRED / 503.
 *
 * The body is timing only -- epoch-ms expiries, the SSO idle window and
 * whether the session is refreshable. Tokens never leave their httpOnly cookies.
 */
export const dynamic = "force-dynamic";

async function sessionTimes() {
  const jar = await cookies();
  return NextResponse.json(describeSessionTimes(jar.get(COOKIE.ACCESS)?.value, jar.get(COOKIE.REFRESH)?.value), {
    headers: { "cache-control": "no-store" },
  });
}

export async function GET() {
  return sessionTimes();
}

export async function POST() {
  return sessionTimes();
}
