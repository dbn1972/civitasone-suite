import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { exchangeAuthorizationCode } from "@civitasone/client-core";
import { getOidcConfig, COOKIE } from "@/lib/auth/config";

const SECURE = process.env.NODE_ENV === "production";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://civitasone.65-2-205-201.nip.io";

// A failed or invalid callback must never leave the browser holding cookies
// that would poison the next attempt: this attempt's PKCE verifier/state,
// and any stale ACCESS/REFRESH left over from an earlier session.
function clearAuthCookies(jar: ReturnType<typeof cookies>) {
  jar.delete(COOKIE.PKCE_VERIFIER);
  jar.delete(COOKIE.OAUTH_STATE);
  jar.delete(COOKIE.ACCESS);
  jar.delete(COOKIE.REFRESH);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = cookies();
  const savedState = jar.get(COOKIE.OAUTH_STATE)?.value;
  const verifier = jar.get(COOKIE.PKCE_VERIFIER)?.value;

  if (!code || !state || !verifier || state !== savedState) {
    clearAuthCookies(jar);
    return NextResponse.redirect(new URL("/auth/login?error=invalid_callback", APP_URL));
  }

  try {
    const tokens = await exchangeAuthorizationCode(getOidcConfig(), code, verifier);
    jar.set(COOKIE.ACCESS, tokens.access_token, { httpOnly: true, secure: SECURE, sameSite: "strict", path: "/", maxAge: tokens.expires_in });
    if (tokens.refresh_token) {
      jar.set(COOKIE.REFRESH, tokens.refresh_token, { httpOnly: true, secure: SECURE, sameSite: "strict", path: "/", maxAge: 60 * 60 * 24 * 30 });
    }
    jar.delete(COOKIE.PKCE_VERIFIER);
    jar.delete(COOKIE.OAUTH_STATE);
    return NextResponse.redirect(new URL("/dashboard", APP_URL));
  } catch (err) {
    console.error("[auth/callback] token exchange failed", err);
    clearAuthCookies(jar);
    return NextResponse.redirect(new URL("/auth/login?error=token_exchange_failed", APP_URL));
  }
}
