import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { exchangeAuthorizationCode } from "@civitasone/client-core";
import { getOidcConfig, COOKIE } from "@/lib/auth/config";

const SECURE = process.env.NODE_ENV === "production";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const jar = cookies();
  const savedState = jar.get(COOKIE.OAUTH_STATE)?.value;
  const verifier = jar.get(COOKIE.PKCE_VERIFIER)?.value;

  if (!code || !state || !verifier || state !== savedState) {
    return NextResponse.redirect(new URL("/auth/login?error=invalid_callback", req.url));
  }

  try {
    const tokens = await exchangeAuthorizationCode(getOidcConfig(), code, verifier);
    jar.set(COOKIE.ACCESS, tokens.access_token, { httpOnly: true, secure: SECURE, sameSite: "lax", path: "/", maxAge: tokens.expires_in });
    if (tokens.refresh_token) {
      jar.set(COOKIE.REFRESH, tokens.refresh_token, { httpOnly: true, secure: SECURE, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
    }
    jar.delete(COOKIE.PKCE_VERIFIER);
    jar.delete(COOKIE.OAUTH_STATE);
    return NextResponse.redirect(new URL("/dashboard", req.url));
  } catch {
    return NextResponse.redirect(new URL("/auth/login?error=token_exchange_failed", req.url));
  }
}
