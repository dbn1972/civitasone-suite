import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { Suspense } from "react";
import LoginClient from "./LoginClient";

/**
 * Login page — auto-redirects to Keycloak OIDC flow immediately.
 * Only shows the UI if there's an error to display (failed login attempt).
 * This eliminates the unnecessary "Sign in with Keycloak" interstitial —
 * professional products (Gmail, Linear, Vercel) go straight to the IDP.
 */
export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string; next?: string };
}) {
  // If there's an error, show the error page with retry button
  if (searchParams.error) {
    return (
      <Suspense fallback={<main className="min-h-screen bg-slate-900" />}>
        <LoginClient />
      </Suspense>
    );
  }

  // No error — skip the interstitial, go directly to Keycloak
  redirect("/api/auth/login");
}
