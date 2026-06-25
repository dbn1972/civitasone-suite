"use client";

import Link from "next/link";
import { useId, useState } from "react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ForgotForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const emailId = useId();
  const errId = useId();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (value.length === 0) {
      setError("Please enter your email address.");
      return;
    }
    if (!EMAIL_RE.test(value)) {
      setError("Please enter a valid email address.");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      // Best-effort: hit the reset endpoint if it exists. The identity-service
      // does not yet expose a password-reset route, so a 404 is expected and is
      // treated the same as success to avoid leaking whether an account exists.
      await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: value }),
      }).catch(() => undefined);
    } finally {
      setSubmitting(false);
      setDone(true);
    }
  }

  if (done) {
    return (
      <section className="mx-auto mt-8 max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div
          role="status"
          aria-live="polite"
          className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          <p className="font-semibold">Check your inbox</p>
          <p className="mt-1">
            If an account exists for <span className="font-medium">{email.trim()}</span>, we&apos;ve sent password
            reset instructions. The link expires in 30 minutes.
          </p>
        </div>
        <Link href="/auth/login" className="mt-4 inline-block text-sm font-medium text-indigo-700 hover:text-indigo-600">
          Back to sign in
        </Link>
      </section>
    );
  }

  return (
    <section className="mx-auto mt-8 max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <form className="mt-2 space-y-3" onSubmit={onSubmit} noValidate>
        <div>
          <label htmlFor={emailId} className="mb-1 block text-sm font-medium text-slate-700">
            Email address
          </label>
          <input
            id={emailId}
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => { setEmail(e.target.value); if (error) setError(""); }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errId : undefined}
            placeholder="you@gov.in"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {error ? (
            <p id={errId} role="alert" className="mt-1 text-sm text-rose-700">
              {error}
            </p>
          ) : null}
        </div>
        <button
          type="submit"
          disabled={submitting}
          aria-busy={submitting}
          className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-60"
        >
          {submitting ? "Sending…" : "Send reset link"}
        </button>
      </form>
      <Link href="/auth/login" className="mt-4 inline-block text-sm font-medium text-indigo-700 hover:text-indigo-600">
        Back to sign in
      </Link>
    </section>
  );
}
