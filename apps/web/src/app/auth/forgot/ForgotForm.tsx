import Link from "next/link";

/**
 * GAP-AUTH-FORGOT-01/02/03/04:
 *
 * The old form POSTed to a non-existent /api/auth/forgot and ALWAYS rendered
 * "Check your inbox … the link expires in 30 minutes" — a fabricated assurance
 * for a flow with no backend (no reset mail was ever sent).
 *
 * Authentication is delegated to Keycloak (OIDC), which owns password
 * recovery. Rather than invent an email flow, we direct the user to the real
 * recovery route (/api/auth/forgot → Keycloak reset-credentials) and to their
 * IT administrator. No "email sent" claim, no invented expiry window.
 */
export function ForgotForm() {
  return (
    <section className="mx-auto mt-8 max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <p className="text-sm text-slate-700">
        Password recovery for CivitasOne is handled by your organisation&apos;s single sign-on. Use the
        button below to open the secure recovery page, where you can reset your credentials.
      </p>

      <a
        href="/api/auth/forgot"
        className="mt-4 inline-block w-full rounded-md bg-indigo-600 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
      >
        Recover account access
      </a>

      <p className="mt-4 text-sm text-slate-600">
        If single sign-on recovery is unavailable for your account, contact your IT administrator or
        service desk — they can reset your credentials and verify your identity.
      </p>

      <Link
        href="/auth/login"
        className="mt-4 inline-block text-sm font-medium text-indigo-700 hover:text-indigo-600"
      >
        Back to sign in
      </Link>
    </section>
  );
}
