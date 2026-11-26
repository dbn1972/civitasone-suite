/**
 * GAP-CRM-SERVICE-REQUESTS-DETAIL-04 (owner decision C9, 2026-11-26): platform-default
 * citizen notice for a resolved / closed service request.
 *
 * The owner approved shipping a platform-default EMAIL template so a tenant that has not
 * authored its own `service_request_resolution` template still tells the citizen the outcome.
 * SMS stays tenant-authored: an SMS to the public needs DLT registration of the exact text, so
 * no default SMS wording is shipped (a tenant with no SMS template keeps the honest
 * `no_template` outcome).
 *
 * The default is PROVISIONED INTO THE TENANT as an ordinary notification-service template the
 * first time it is needed, so the tenant admin sees it in the template list and can edit it
 * (lookup is by name, so an edited or replaced template always wins over this default).
 * Variables are the ones the notify consumer already sends: citizenName, referenceNo, status.
 *
 * WORDING: owner-approved per the decision sheet; the exact copy below is the proposed text and
 * is the single place to edit it.
 */

/** Name shared with the notify consumer's lookup (re-exported there as SR_RESOLUTION_TEMPLATE_NAME). */
export const DEFAULT_SR_TEMPLATE_NAME = "service_request_resolution";

export interface DefaultTemplateSpec {
  channel: "email";
  name: string;
  subject: string;
  body: string;
}

export const DEFAULT_SR_RESOLUTION_EMAIL: DefaultTemplateSpec = {
  channel: "email",
  name: DEFAULT_SR_TEMPLATE_NAME,
  subject: "Your service request {{referenceNo}} is now {{status}}",
  body: [
    "Dear {{citizenName}},",
    "",
    "Your service request {{referenceNo}} has been marked {{status}}.",
    "",
    "If you believe this request has not been resolved to your satisfaction, please contact the office and quote the reference number above.",
    "",
    "This is an automated message; please do not reply to this email.",
  ].join("\n"),
};

/** Variables the default wording uses; the consumer must supply every one of them. */
export const DEFAULT_SR_TEMPLATE_VARIABLES = ["citizenName", "referenceNo", "status"] as const;

/** Names of the {{variables}} referenced by a template text (pure; used by the unit test). */
export function templateVariablesOf(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) out.add(m[1]!);
  return [...out].sort();
}
