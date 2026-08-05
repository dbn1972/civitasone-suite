export type CampaignView = {
  id: string;
  tenantId: string;
  templateId: string;
  name: string;
  status: string;
  scheduledAt: string | null;
  // MK-001/MK-004 marketing fields. Money is a decimal STRING (bigint paise).
  objective: string | null;
  audienceSegmentId: string | null;
  budgetMinor: string;
  currency: string;
  actualCostMinor: string;
  version: number;
  recipientCount?: number;
  deliveredCount?: number;
};

export type CampaignRecipientView = {
  id: string;
  campaignId: string;
  recipientId: string;
  status: string;
  deliveryId: string | null;
};

/** One row in GET /notifications/campaigns. budgetMinor is bigint-paise string. */
export type CampaignListItem = {
  id: string;
  name: string;
  objective: string | null;
  status: string;
  budgetMinor: string;
  currency: string;
  audienceSegmentId: string | null;
  scheduledAt: string | null;
  createdAt: string;
};

export type CampaignListResult = {
  campaigns: CampaignListItem[];
  total: number;
};

/** GET /notifications/campaigns/:id/metrics — all money fields bigint-paise strings. */
export type CampaignMetrics = {
  campaignId: string;
  recipients: number;
  delivered: number;
  failed: number;
  responses: number;
  conversions: number;
  budgetMinor: string;
  actualCostMinor: string;
  attributedRevenueMinor: string;
  /** basis points, integer BigInt arithmetic; null when actualCost = 0 (div-by-zero). */
  roiBps: number | null;
  currency: string;
};

export type CampaignResponseView = {
  id: string;
  campaignId: string;
  subjectType: string;
  subjectId: string;
  responded: boolean;
  converted: boolean;
  revenueMinor: string;
  respondedAt: string;
};

/**
 * ROI in basis points, computed entirely in BigInt (integer) arithmetic — no
 * float ever touches money. roiBps = ((revenue - cost) / cost) * 10000.
 * When cost = 0 the ratio is undefined (division by zero) so we return null
 * rather than Infinity/NaN; callers must treat null as "not computable".
 * BigInt division truncates toward zero, which is the intended basis-point floor.
 */
export function computeRoiBps(attributedRevenueMinor: bigint, actualCostMinor: bigint): number | null {
  if (actualCostMinor === 0n) return null;
  return Number(((attributedRevenueMinor - actualCostMinor) * 10000n) / actualCostMinor);
}
