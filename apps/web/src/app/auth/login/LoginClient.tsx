"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@civitasone/ui-kit";

export default function LoginClient() {
  const params = useSearchParams();
  const error = params.get("error");

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-900 to-slate-950 text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl items-center justify-center px-6 py-12">
        <section className="w-full max-w-md rounded-2xl border border-white/10 bg-white/95 p-8 text-slate-900 shadow-2xl backdrop-blur">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-indigo-700">CivitasOne Suite</p>
          <h1 className="text-2xl font-bold">Sign in to your workspace</h1>
          <p className="mt-1 text-sm text-slate-600">
            Gmail-grade security: device-bound session, PKCE, and offline sync.
          </p>

          {error ? (
            <div className="mt-4 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
              Sign-in failed ({error}). Please try again.
            </div>
          ) : null}

          <div className="mt-6 space-y-3">
            <a href="/api/auth/login" className="block">
              <Button variant="primary" className="w-full">Sign in with Keycloak (PKCE)</Button>
            </a>
            <p className="text-xs text-slate-500 text-center">
              Your browser is registered as a trusted device after first login.
            </p>
          </div>

          <div className="mt-6 flex items-center justify-between text-xs text-slate-600">
            <Link className="font-medium text-indigo-700 hover:text-indigo-600" href="/auth/forgot">
              Forgot password?
            </Link>
            <span>Contact your admin for access</span>
          </div>
        </section>
      </div>
    </main>
  );
}
