import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { generatePkcePair, buildAuthorizeUrl, exchangeAuthorizationCode } from "@civitasone/client-core";
import { getOidcConfig, COOKIE } from "@/lib/auth/config";

const SECURE = process.env.NODE_ENV === "production";

export async function GET() {
  const oidc = getOidcConfig();
  const pkce = await generatePkcePair();
  const state = crypto.randomUUID();
  const jar = cookies();

  jar.set(COOKIE.PKCE_VERIFIER, pkce.codeVerifier, { httpOnly: true, secure: SECURE, sameSite: "lax", path: "/", maxAge: 600 });
  jar.set(COOKIE.OAUTH_STATE, state, { httpOnly: true, secure: SECURE, sameSite: "lax", path: "/", maxAge: 600 });

  const url = buildAuthorizeUrl(oidc, pkce, state);
  redirect(url);
}
