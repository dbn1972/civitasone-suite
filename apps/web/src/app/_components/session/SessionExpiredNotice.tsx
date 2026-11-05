"use client";
/**
 * UAT T-EDGE TE-10: an API call failed because the session expired while a form was being filled
 * (the middleware now answers 401 SESSION_EXPIRED instead of a redirect). The form keeps what was
 * typed; this notice says so and offers "Sign in again", which opens the sign-in page in a NEW TAB
 * that returns to this page afterwards -- so this tab, with the entries, stays as it is and the
 * user submits again once signed in. Mounted once in the app shell, next to SessionTimeoutWarning.
 *
 * Triggered by lib/validationCopy.ts SESSION_EXPIRED_EVENT (dispatched by useFormError on a 401).
 * Copy: errorCatalogue.ts DOMAIN_CODE_MESSAGES.SESSION_EXPIRED (en/hi, the #2451 layer).
 */
import { useEffect, useState } from "react";
import { DOMAIN_CODE_MESSAGES, getClientLocale } from "@/lib/errorCatalogue";
import { sessionExpiredLoginUrl } from "@/lib/auth/sessionClient";
import { SESSION_EXPIRED_EVENT } from "@/lib/validationCopy";

const LABELS = {
  en: { signIn: "Sign in again", newTab: "(opens in a new tab)", dismiss: "Dismiss" },
  hi: { signIn: "दोबारा साइन इन करें", newTab: "(नए टैब में खुलता है)", dismiss: "बंद करें" },
} as const;

export function SessionExpiredNotice() {
  const [open, setOpen] = useState(false);
  const [returnTo, setReturnTo] = useState("/dashboard");

  useEffect(() => {
    const onExpired = () => {
      setReturnTo(`${window.location.pathname}${window.location.search}`);
      setOpen(true);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  if (!open) return null;
  const locale = getClientLocale();
  const copy = DOMAIN_CODE_MESSAGES.SESSION_EXPIRED![locale];
  const labels = LABELS[locale];
  return (
    <div
      role="alert"
      data-testid="session-expired-notice"
      style={{
        position: "fixed", insetInline: 16, bottom: 16, zIndex: 1000, maxWidth: 560, marginInline: "auto",
        background: "var(--surface, #fff)", color: "var(--ink, #111)", border: "1px solid var(--warn, #b45309)",
        borderRadius: 8, padding: "12px 16px", boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
        display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center",
      }}
    >
      <p style={{ margin: 0, flex: "1 1 240px" }}>
        <strong>{copy.what}</strong> {copy.next}
      </p>
      <a className="btn primary" href={sessionExpiredLoginUrl(returnTo)} target="_blank" rel="noopener noreferrer">
        {labels.signIn} <span className="sr-only">{labels.newTab}</span>
      </a>
      <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
        {labels.dismiss}
      </button>
    </div>
  );
}
