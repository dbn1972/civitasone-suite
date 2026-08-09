"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

/**
 * LoginClient — only shown when an error occurs during authentication.
 * Normal flow auto-redirects to Keycloak without showing this page.
 */
export default function LoginClient() {
  const params = useSearchParams();
  const error = params.get("error");

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
          <p className="text-sm text-slate-500 mb-6">
            {error === "access_denied"
              ? "Access was denied. Contact your administrator."
              : error === "session_expired"
              ? "Your session expired. Please sign in again."
              : `Authentication failed (${error ?? "unknown"}). Please try again.`}
          </p>
        </div>

        <a
          href="/api/auth/login"
          className="block w-full rounded-lg bg-indigo-600 px-4 py-3 text-center text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
        >
          Try again
        </a>

        <div className="mt-5 flex items-center justify-between text-xs text-slate-500">
          <Link href="/auth/forgot" className="text-indigo-600 hover:text-indigo-700 font-medium">
            Reset password
          </Link>
          <span>Need help? Contact IT</span>
        </div>
      </section>
    </main>
  );
}
