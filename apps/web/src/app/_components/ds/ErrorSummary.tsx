"use client";

import { useEffect, useId, useRef } from "react";
import { formatReference, getClientLocale, type ErrorLocale } from "@/lib/errorCatalogue";

/**
 * ErrorSummary — the GOV.UK error-summary pattern for forms.
 *
 * Shown at the top of a form after a failed submit. It moves keyboard focus to
 * itself when it appears (so screen-reader and keyboard users land on it) and
 * is a `role="alert"` region, so the message is announced (WCAG 2.2 SC 3.3.1,
 * 4.1.3). Each field-level message is a link to its field. The support
 * reference is a quiet secondary line, never the message.
 *
 * Feed it straight from `useFormError`: `<ErrorSummary error={form} />`. It
 * renders nothing while there is no message.
 */
const TITLE: Record<ErrorLocale, string> = { en: "There is a problem", hi: "एक समस्या है" };

export type ErrorSummaryProps = {
  error: { message: string; fieldErrors?: Record<string, string>; reference?: string | null };
  /** Element id for a field name. Defaults to the field name itself. */
  fieldId?: (field: string) => string;
  /** Move focus to the summary when it appears or its message changes. Default true. */
  autoFocus?: boolean;
  locale?: ErrorLocale;
};

export function ErrorSummary({ error, fieldId = (f) => f, autoFocus = true, locale }: ErrorSummaryProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const entries = Object.entries(error.fieldErrors ?? {});
  const hasContent = Boolean(error.message) || entries.length > 0;

  useEffect(() => {
    if (autoFocus && hasContent) ref.current?.focus();
  }, [autoFocus, hasContent, error.message, error.reference]);

  if (!hasContent) return null;
  const loc = locale ?? getClientLocale();
  const ref_ = formatReference(error.reference, loc);

  return (
    <div
      ref={ref}
      role="alert"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-testid="error-summary"
      className="alert bad"
      style={{ padding: "12px 16px", marginBottom: 16, borderRadius: 8, border: "2px solid var(--bad)" }}
    >
      <h2 id={titleId} style={{ fontSize: 16, margin: "0 0 6px", fontWeight: 700 }}>
        {TITLE[loc]}
      </h2>
      {error.message && <p style={{ margin: "0 0 6px", fontSize: 14 }}>{error.message}</p>}
      {entries.length > 0 && (
        <ul style={{ margin: "0 0 6px", paddingLeft: 18, fontSize: 14 }}>
          {entries.map(([field, message]) => (
            <li key={field}>
              <a href={`#${fieldId(field)}`} style={{ color: "inherit", fontWeight: 600 }}>
                {message}
              </a>
            </li>
          ))}
        </ul>
      )}
      {ref_ && <p style={{ margin: 0, fontSize: 12, opacity: 0.75 }}>{ref_}</p>}
    </div>
  );
}
