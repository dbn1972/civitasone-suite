import { redirect } from "next/navigation";
import { safeNextPath } from "@/lib/auth/safeNext";
import { Suspense } from "react";
import LoginClient from "./LoginClient";

/**
 * Login page — auto-redirects to Keycloak OIDC flow immediately.
 * Only shows the UI if there's an error to display (failed login attempt).
 * This eliminates the unnecessary "Sign in with Keycloak" interstitial —
 * professional products (Gmail, Linear, Vercel) go straight to the IDP.
 */

// GAP-AUTH-LOGIN-02: only a same-origin absolute path is a safe destination.
function safeNext(next: string | undefined): string | null {
  return safeNextPath(next);
}

// GAP-AUTH-LOGIN-04: a branded, announced loading state instead of an empty
// dark box, for the brief moment the error client component suspends on
// useSearchParams().
function LoginFallback() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-950 flex items-center justify-center px-4">
      <div role="status" aria-live="polite" className="text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-indigo-300 mb-2">
          CivitasOne Suite
        </p>
        <p className="text-sm text-slate-300">Loading sign-in…</p>
      </div>
    </main>
  );
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: { error?: string; next?: string };
}) {
  const next = safeNext(searchParams.next);

  // If there's an error, show the error page with retry button
  if (searchParams.error) {
    return (
      <Suspense fallback={<LoginFallback />}>
        <LoginClient next={next ?? undefined} />
      </Suspense>
    );
  }

  // No error — skip the interstitial, go directly to Keycloak, carrying the
  // deep-link destination so the callback can land the user there.
  redirect(next ? `/api/auth/login?next=${encodeURIComponent(next)}` : "/api/auth/login");
}
