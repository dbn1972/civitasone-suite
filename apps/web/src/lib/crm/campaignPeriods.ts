/**
 * Campaign performance (period) posting — GAP-CRM-CAMPAIGNS-DETAIL-04.
 *
 * The campaign detail page's empty state told the user to "post a reporting
 * period's cost and revenue" but offered no way to do it. crm-service does
 * expose the write path:
 *
 *   PUT /v1/crm/campaigns/:id/performance  (campaign-roi-routes.ts)
 *
 * It is admin-gated server-side (crm_admin/super_admin/tenant_admin), accepts
 * money as non-negative minor-unit (paise) STRINGS, and is idempotent on
 * (campaign, periodStart) so re-posting a period corrects the row rather than
 * double-counting spend. This client forwards a clerk's rupee entry converted
 * to paise with the shared `rupeesToMinorString` (never float arithmetic).
 */
import { browserFetch, errorMessageFromResponse } from "@/lib/api/browserClient";
import { rupeesToMinorString } from "@/lib/money";
import { UserFacingError } from "@/lib/userFacingError";

export interface PostPeriodInput {
  /** ISO date YYYY-MM-DD */
  periodStart: string;
  /** ISO date YYYY-MM-DD, optional; must not precede periodStart. */
  periodEnd?: string;
  /** Rupees decimal string as typed (e.g. "1500.50"); converted to paise. */
  costRupees: string;
  revenueRupees: string;
  responses: number;
  /** ISO-4217 currency code; defaults to INR. */
  currency?: string;
}

export class CampaignPeriodValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CampaignPeriodValidationError";
  }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Build the request body for the performance upsert, converting rupees to
 * paise strings. Throws CampaignPeriodValidationError on bad input so the form
 * can show a field-level message instead of sending a request the backend
 * would 400. Cost and revenue allow zero (a period legitimately may have no
 * spend or no revenue yet); responses must be a non-negative integer.
 */
export function buildPerformanceBody(input: PostPeriodInput): {
  periodStart: string;
  periodEnd?: string;
  costMinor: string;
  revenueMinor: string;
  responses: number;
  currency: string;
} {
  if (!ISO_DATE.test(input.periodStart)) {
    throw new CampaignPeriodValidationError("Enter a valid period start date.");
  }
  if (input.periodEnd && !ISO_DATE.test(input.periodEnd)) {
    throw new CampaignPeriodValidationError("Enter a valid period end date.");
  }
  if (input.periodEnd && input.periodEnd < input.periodStart) {
    throw new CampaignPeriodValidationError("The period end date cannot be before the start date.");
  }
  const costMinor = rupeesToMinorString(input.costRupees, { allowZero: true });
  if (costMinor === null) {
    throw new CampaignPeriodValidationError("Enter the spend as rupees (up to two decimal places).");
  }
  const revenueMinor = rupeesToMinorString(input.revenueRupees, { allowZero: true });
  if (revenueMinor === null) {
    throw new CampaignPeriodValidationError("Enter the revenue as rupees (up to two decimal places).");
  }
  if (!Number.isInteger(input.responses) || input.responses < 0) {
    throw new CampaignPeriodValidationError("Responses must be a whole number of zero or more.");
  }
  return {
    periodStart: input.periodStart,
    ...(input.periodEnd ? { periodEnd: input.periodEnd } : {}),
    costMinor,
    revenueMinor,
    responses: input.responses,
    currency: (input.currency ?? "INR").toUpperCase(),
  };
}

/** Post (upsert) a reporting period's cost, revenue and responses for a campaign. */
export async function postCampaignPeriod(campaignId: string, input: PostPeriodInput): Promise<void> {
  const body = buildPerformanceBody(input);
  const res = await browserFetch(`v1/crm/campaigns/${campaignId}/performance`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new UserFacingError(await errorMessageFromResponse(res));
}
