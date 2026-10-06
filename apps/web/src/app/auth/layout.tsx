import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE } from "@/lib/auth/config";

// GAP-AUTH-DEV-05: the previous check looked for a cookie
// (`civitasone_demo_auth`) that nothing in apps/web ever sets, so the redirect
// was dead code. The real session cookie is COOKIE.ACCESS (`civitasone_at`),
// set by both the Keycloak callback and the dev-login route. We validate that
// the token is present AND not structurally expired before redirecting an
// already-signed-in user away from the auth screens — checking presence alone
// would create a redirect loop when a stale-but-present cookie lingers.
function hasLiveSession(token: string | undefined): boolean {
  if (!token) return false;
  try {
    const part = token.split(".")[1];
    if (!part) return false;
    const payload = JSON.parse(Buffer.from(part, "base64url").toString()) as { exp?: number };
    if (typeof payload.exp !== "number") return false;
    return payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

export default function AuthLayout({ children }: { children: ReactNode }) {
  const token = cookies().get(COOKIE.ACCESS)?.value;
  if (hasLiveSession(token)) {
    redirect("/dashboard");
  }

  return children;
}
