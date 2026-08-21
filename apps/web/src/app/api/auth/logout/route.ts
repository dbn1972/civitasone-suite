import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE } from "@/lib/auth/config";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://civitasone.65-2-205-201.nip.io";

function clearAuthCookies(jar: ReturnType<typeof cookies>) {
  jar.delete(COOKIE.ACCESS);
  jar.delete(COOKIE.REFRESH);
  jar.delete(COOKIE.DEVICE_TRUST);
  jar.delete(COOKIE.PKCE_VERIFIER);
  jar.delete(COOKIE.OAUTH_STATE);
}

export async function POST() {
  clearAuthCookies(cookies());
  return NextResponse.json({ ok: true });
}

// Bug fix: this route previously exported POST only, so a plain browser
// navigation here (typing the URL, or following a bare <a href> link) sent
// a GET request that Next.js answered with 405 — the handler never ran, no
// cookies were touched, and the browser was left exactly as poisoned as
// before. That's why hitting this URL directly never resolved a stuck
// session. Add GET support so direct navigation actually clears state.
//
// The OAuth-flow artifacts (PKCE verifier/state) are specific to a failed
// /api/auth/callback attempt, so clear those here; the rest of sign-out
// (app cookies + terminating the Keycloak SSO session) is delegated to
// /logout, which already does that correctly — see its comment for why
// just clearing app cookies and redirecting to /auth/login isn't enough.
export async function GET() {
  const jar = cookies();
  jar.delete(COOKIE.PKCE_VERIFIER);
  jar.delete(COOKIE.OAUTH_STATE);
  return NextResponse.redirect(new URL("/logout", APP_URL));
}
