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
 * GAP-CRM-LEAD-FORMS-03: human labels for the health enum. The raw value
 * "unlawful" must never be printed verbatim as a pill label — it is both an
 * internal enum and a legal conclusion the UI should not assert. The condition
 * is "enabled without requiring consent", surfaced as "Consent gaps" on the
 * tile; the per-row pill says "Consent not required" (what is actually true of
 * the form's configuration). The enum stays internal.
 */
export const HEALTH_LABEL: Record<FormHealth, string> = {
  live: "Live",
  paused: "Paused",
  unlawful: "Consent not required",
};

/** The DPDP explanation shown when any form is in the consent-gap state. */
export const CONSENT_GAP_NOTE =
  "Enabled without requiring consent. The DPDP Act 2023 requires consent for marketing-intake forms — require consent or pause these forms.";

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

export function originSummary(
  origins: string[],
  labels: { any: string; more: (count: number) => string } = {
    any: "Any origin",
    more: (count) => `+${count} more`,
  },
): string {
  if (origins.length === 0) return labels.any;
  if (origins.length === 1) return origins[0]!;
  return `${origins[0]} ${labels.more(origins.length - 1)}`;
}
