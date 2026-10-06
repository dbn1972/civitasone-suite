import { cookies } from "next/headers";
import { safeNextPath } from "@/lib/auth/safeNext";
import { redirect } from "next/navigation";
import { generatePkcePair, buildAuthorizeUrl } from "@civitasone/client-core";
import { getOidcConfig, COOKIE } from "@/lib/auth/config";

const SECURE = process.env.NODE_ENV === "production";

// GAP-AUTH-LOGIN-02: only a same-origin absolute path is a safe post-login
// destination. Must start with a single "/" (not "//", which browsers treat
// as a protocol-relative URL to another origin).

export async function GET(req: Request) {
  const oidc = getOidcConfig();
  const pkce = await generatePkcePair();
  const state = crypto.randomUUID();
  const jar = cookies();

  jar.set(COOKIE.PKCE_VERIFIER, pkce.codeVerifier, { httpOnly: true, secure: SECURE, sameSite: "lax", path: "/", maxAge: 600 });
  jar.set(COOKIE.OAUTH_STATE, state, { httpOnly: true, secure: SECURE, sameSite: "lax", path: "/", maxAge: 600 });

  // GAP-AUTH-LOGIN-02: carry the (validated) deep-link destination through the
  // OIDC round-trip in a short-lived cookie, so the callback can land the user
  // where they originally tried to go.
  const next = safeNextPath(new URL(req.url).searchParams.get("next") ?? undefined);
  if (next) {
    jar.set(COOKIE.POST_LOGIN_NEXT, next, { httpOnly: true, secure: SECURE, sameSite: "lax", path: "/", maxAge: 600 });
  } else {
    jar.delete(COOKIE.POST_LOGIN_NEXT);
  }

  const url = buildAuthorizeUrl(oidc, pkce, state);
  redirect(url);
}
