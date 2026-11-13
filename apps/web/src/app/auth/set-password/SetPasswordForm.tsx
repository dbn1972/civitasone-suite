"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";

const POLICY = "At least 12 characters, with upper and lower case letters, a digit and a special character.";

/**
 * The link an administrator hands over looks like /auth/set-password#token=...  The token is in the URL
 * FRAGMENT so it is never sent to a server or written to an access log on the way; it is read once into memory
 * and removed from the address bar. The password is held only in this component's state and posted over HTTPS.
 */
export function SetPasswordForm() {
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const m = /(?:^#|&)token=([^&]+)/.exec(window.location.hash);
    if (m?.[1]) setToken(decodeURIComponent(m[1]));
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) { setError("The two passwords do not match."); return; }
    if (password.length < 12) { setError(POLICY); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/set-password", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, password }),
      });
      const json = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
      if (res.ok) { setDone(true); setPassword(""); setConfirm(""); return; }
      if (json.code === "PASSWORD_POLICY") setError(`That password does not meet the policy. ${POLICY}`);
      else if (json.code === "INVALID_OR_EXPIRED_TOKEN") setError("This link is invalid or has expired. Ask your administrator for a new one.");
      else setError("We could not set the password just now. Please try again shortly.");
    } catch {
      setError("We could not reach the service. Please try again shortly.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <section role="status" className="text-center">
        <p className="text-sm text-slate-700">Your password is set. You can sign in now.</p>
        <Link href="/auth/login" className="mt-4 inline-block rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500">Go to sign in</Link>
      </section>
    );
  }
  if (token === null) {
    return <p role="alert" className="text-sm text-slate-700">This page needs the link your administrator gave you. Open that link again, or ask for a new one.</p>;
  }
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
      <div>
        <label htmlFor="sp-password" className="block text-sm font-medium text-slate-700">New password</label>
        <input id="sp-password" type="password" autoComplete="new-password" required maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" aria-describedby="sp-policy" />
      </div>
      <div>
        <label htmlFor="sp-confirm" className="block text-sm font-medium text-slate-700">Confirm password</label>
        <input id="sp-confirm" type="password" autoComplete="new-password" required maxLength={128} value={confirm} onChange={(e) => setConfirm(e.target.value)} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <p id="sp-policy" className="text-xs text-slate-500">{POLICY}</p>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button type="submit" disabled={busy} className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60">{busy ? "Saving…" : "Set password"}</button>
    </form>
  );
}
