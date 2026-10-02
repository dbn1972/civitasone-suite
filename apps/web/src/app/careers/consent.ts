/**
 * DPDP notice shown above the apply button (GAP-RECRUITMENT-CAREERS-DETAIL-02).
 *
 * CAREERS_CONSENT_VERSION is sent with the application and stored beside the
 * consent timestamp, so any change to the wording below MUST bump it. The
 * retention sentence and the grievance contact are placeholders for the legal
 * owner to confirm; the contact and the policy link are configurable per
 * deployment through NEXT_PUBLIC_ env vars.
 */
export { CAREERS_CONSENT_VERSION } from "@civitasone/schemas";

export const CAREERS_CONSENT_PURPOSE =
  "We collect your name, email, mobile number, qualification and related details only to assess your application for this post and to contact you about it.";

export const CAREERS_CONSENT_RETENTION =
  "Your details are kept for the duration of this recruitment and for as long as recruitment records must be retained under applicable rules, and are then deleted.";

export function careersGrievanceContact(): string | null {
  const v = process.env.NEXT_PUBLIC_CAREERS_GRIEVANCE_CONTACT?.trim();
  return v ? v : null;
}

export function careersPrivacyPolicyUrl(): string | null {
  const v = process.env.NEXT_PUBLIC_PRIVACY_POLICY_URL?.trim();
  return v && /^https?:\/\/|^\/(?!\/)/.test(v) ? v : null;
}
