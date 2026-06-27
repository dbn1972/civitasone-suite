"use client";

import Link from "next/link";
import { ACTION_LABELS, type HumanError, type SafeAction } from "@/lib/messages";

/**
 * ErrorState — renders a plain-language {what, next, actions} message with safe
 * recovery buttons. No transport detail ever reaches the clerk. Requirements 5, 6.
 *
 * - "retry" calls onRetry (when provided).
 * - "back" calls onBack, or navigates to backHref when provided.
 * - "help" links to the Help Centre (or a module guide via helpHref).
 */
export function ErrorState({
  error,
  onRetry,
  onBack,
  backHref,
  helpHref = "/help",
}: {
  error: HumanError;
  onRetry?: () => void;
  onBack?: () => void;
  backHref?: string;
  helpHref?: string;
}) {
  return (
    <div className="empty-state" role="alert" aria-live="assertive" style={{ textAlign: "center" }}>
      <div className="ic" aria-hidden="true">⚠️</div>
      <h4>{error.what}</h4>
      <p>{error.next}</p>
      <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap", marginTop: 6 }}>
        {error.actions.map((action: SafeAction) => {
          if (action === "retry") {
            return onRetry ? (
              <button key={action} type="button" className="btn primary" onClick={onRetry}>
                {ACTION_LABELS.retry}
              </button>
            ) : null;
          }
          if (action === "back") {
            if (backHref) {
              return (
                <Link key={action} href={backHref} className="btn ghost">
                  {ACTION_LABELS.back}
                </Link>
              );
            }
            return onBack ? (
              <button key={action} type="button" className="btn ghost" onClick={onBack}>
                {ACTION_LABELS.back}
              </button>
            ) : null;
          }
          // help
          return (
            <Link key={action} href={helpHref} className="btn ghost">
              {ACTION_LABELS.help}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
