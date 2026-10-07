"use client";

import { useState } from "react";

/**
 * GAP-AUTH-DEV-04: the dev-login form is a native POST (so it works without
 * JS and keeps the server as the single source of truth), but a double-click
 * previously fired two POSTs. This thin client wrapper disables the submit
 * button as soon as the form starts submitting, so only one request leaves the
 * browser. It adds no new client-only dependencies and imports no server-only
 * modules.
 */
export function DevLoginForm({ next }: { next: string }) {
  const [submitting, setSubmitting] = useState(false);

  return (
    <form
      method="POST"
      action="/api/auth/dev-login"
      onSubmit={() => setSubmitting(true)}
    >
      {next && <input type="hidden" name="next" value={next} />}

      <label htmlFor="username" className="devlogin-label">Username</label>
      <input id="username" name="username" autoComplete="username" required
        placeholder="dnayak" className="devlogin-input" />

      <label htmlFor="password" className="devlogin-label">Password</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required
        placeholder="••••••••" className="devlogin-input" />

      <label htmlFor="tenant" className="devlogin-label">
        Office ID <span className="devlogin-label-hint">(optional)</span>
      </label>
      <input id="tenant" name="tenant" autoComplete="off"
        placeholder="leave blank for the default office" className="devlogin-input" />

      <button type="submit" className="devlogin-btn" disabled={submitting} aria-busy={submitting}>
        {submitting ? "Signing in…" : "Sign in →"}
      </button>
    </form>
  );
}
