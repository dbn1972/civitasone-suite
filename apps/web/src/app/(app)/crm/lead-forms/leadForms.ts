/**
 * Pure helpers for the website lead-capture form registry (P1-7).
 *
 * The public POST path is unauthenticated and keyed only by `formKey`, so the
 * admin screen must show the exact URL operators embed on landing pages — and
 * must never invent a path the gateway does not expose.
 */
import type { CRMLeadCaptureForm } from "@civitasone/types";

/** Gateway-relative public submit path for a minted form key. */
export function publicSubmitPath(formKey: string): string {
  return `/api/v1/crm/public/leads/${encodeURIComponent(formKey)}`;
}

export type FormHealth = "live" | "paused" | "unlawful";

/**
 * A form that is enabled but does not require consent is an unlawful-capture
 * risk under DPDP for marketing intake — surface it louder than a deliberate pause.
 */
export function formHealth(form: Pick<CRMLeadCaptureForm, "enabled" | "requireConsent">): FormHealth {
  if (!form.enabled) return "paused";
  if (!form.requireConsent) return "unlawful";
  return "live";
}

export function rankForms(forms: CRMLeadCaptureForm[]): CRMLeadCaptureForm[] {
  const rank: Record<FormHealth, number> = { unlawful: 0, live: 1, paused: 2 };
  return [...forms].sort((a, b) => {
    const ha = formHealth(a);
    const hb = formHealth(b);
    if (ha !== hb) return rank[ha] - rank[hb];
    return a.name.localeCompare(b.name);
  });
}

export function originSummary(origins: string[]): string {
  if (origins.length === 0) return "Any origin";
  if (origins.length === 1) return origins[0]!;
  return `${origins[0]} +${origins.length - 1} more`;
}
