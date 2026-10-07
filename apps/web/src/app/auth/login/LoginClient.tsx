"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

/**
 * LoginClient — only shown when an error occurs during authentication.
 * Normal flow auto-redirects to Keycloak without showing this page.
 */

// GAP-AUTH-LOGIN-03 / LOGIN-06: map every error code the OIDC flow can emit to
// friendly, non-technical copy. Codes known to be produced:
//   - invalid_callback / token_exchange_failed (api/auth/callback/route.ts)
//   - access_denied (Keycloak refuses / user cancels)
//   - session_expired (middleware / session expiry)
// Any unmapped code falls back to a generic message; the raw code is shown
// only as a small "Reference" string for support, never as the headline.
const FRIENDLY_ERRORS: Record<string, string> = {
  access_denied: "Access was denied. Contact your administrator if you believe this is a mistake.",
  session_expired: "Your session expired. Please sign in again.",
  invalid_callback: "We couldn't complete sign-in securely. Please try again.",
  token_exchange_failed: "We couldn't complete sign-in with the identity provider. Please try again.",
  invalid_state: "Your sign-in attempt could not be verified. Please try again.",
};

const GENERIC_ERROR = "Sign-in didn't complete. Please try again.";
const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "it-support@civitasone.gov.in";

export default function LoginClient({ next }: { next?: string } = {}) {
  const params = useSearchParams();
  const error = params.get("error") ?? undefined;
  const nextParam = next ?? params.get("next") ?? undefined;

  const message = (error && FRIENDLY_ERRORS[error]) || GENERIC_ERROR;
  const retryHref = nextParam
    ? `/api/auth/login?next=${encodeURIComponent(nextParam)}`
    : "/api/auth/login";

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-950 flex items-center justify-center px-4">
      <section className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-2xl">
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600 mb-3">
            CivitasOne Suite
          </p>
          <h1 className="text-xl font-bold text-slate-900 mb-2">
            Sign-in unsuccessful
          </h1>
          <p className="text-sm text-slate-500 mb-2">{message}</p>
          {error ? (
            <p className="text-xs text-slate-600 mb-6">Reference: {error}</p>
          ) : (
            <div className="mb-6" />
          )}
        </div>

        <a
          href={retryHref}
          className="block w-full rounded-lg bg-indigo-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
        >
          Try again
        </a>

        <div className="mt-5 flex items-center justify-between text-xs text-slate-500">
          <Link href="/auth/forgot" className="text-indigo-600 hover:text-indigo-700 font-medium">
            Reset password
          </Link>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-indigo-600 hover:text-indigo-700 font-medium">
            Need help? Contact IT
          </a>
        </div>
      </section>
    </main>
  );
}
