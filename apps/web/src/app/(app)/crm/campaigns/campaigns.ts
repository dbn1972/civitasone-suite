/**
 * Pure helpers for the CRM campaign ROI screens (P1-6).
 *
 * crm-service returns every money figure as a bigint paise string and ROI as an
 * integer basis-point string (or null when spend was zero). Everything that
 * folds or presents those numbers lives here so it can be tested without
 * rendering, and so the paise arithmetic stays in bigint space — a campaign
 * portfolio runs to crores, and a float fold there loses rupees.
 */
import type { CRMCampaignRoiPeriod, CRMCampaignRoiSummaryRow } from "@civitasone/types";

/** Whether a campaign made money, lost money, or has no spend to judge against. */
export type RoiVerdict = "profit" | "loss" | "breakeven" | "unmeasured";

export interface PortfolioTotals {
  campaigns: number;
  costMinor: string;
  revenueMinor: string;
  netMinor: string;
  responses: number;
  /** Portfolio ROI in basis points, or null when nothing was spent. */
  roiBasisPoints: string | null;
}

function toBigInt(value: string | null | undefined): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

/**
 * Portfolio ROI recomputed from the summed cost and revenue rather than averaged
 * from the per-campaign percentages. Averaging percentages would weight a ₹500
 * campaign the same as a ₹50 lakh one and report a portfolio that is not real.
 */
export function portfolioTotals(rows: CRMCampaignRoiSummaryRow[]): PortfolioTotals {
  let cost = 0n;
  let revenue = 0n;
  let responses = 0;
  for (const row of rows) {
    cost += toBigInt(row.costMinor);
    revenue += toBigInt(row.revenueMinor);
    responses += row.responses;
  }
  return {
    campaigns: rows.length,
    costMinor: cost.toString(),
    revenueMinor: revenue.toString(),
    netMinor: (revenue - cost).toString(),
    responses,
    roiBasisPoints: cost === 0n ? null : (((revenue - cost) * 10000n) / cost).toString(),
  };
}

/**
 * Classifies a campaign from its net position.
 *
 * `unmeasured` is deliberately distinct from `breakeven`: a campaign with no
 * recorded spend has an undefined ROI, and showing that as break-even would
 * tell a marketing officer the campaign washed its face when in truth nobody
 * has entered its cost yet.
 */
export function roiVerdict(row: { costMinor: string; netMinor: string }): RoiVerdict {
  if (toBigInt(row.costMinor) === 0n) return "unmeasured";
  const net = toBigInt(row.netMinor);
  if (net > 0n) return "profit";
  if (net < 0n) return "loss";
  return "breakeven";
}

/**
 * ROI for display. The service already renders basis points to two decimals, so
 * this only adds the sign and the percent marker and keeps the "no spend, no
 * ROI" case as an em dash rather than 0%.
 */
export function formatRoiPercent(roiPercent: string | null | undefined): string {
  if (roiPercent === null || roiPercent === undefined || roiPercent === "") return "—";
  return roiPercent.startsWith("-") ? `${roiPercent}%` : `+${roiPercent}%`;
}

/**
 * Orders campaigns by net contribution, biggest earner first, with losses last.
 * Ties fall back to campaign id so the table order is stable across reloads.
 */
export function rankByNet(rows: CRMCampaignRoiSummaryRow[]): CRMCampaignRoiSummaryRow[] {
  return [...rows].sort((a, b) => {
    const netA = toBigInt(a.netMinor);
    const netB = toBigInt(b.netMinor);
    if (netA !== netB) return netA > netB ? -1 : 1;
    return a.campaignId.localeCompare(b.campaignId);
  });
}

/**
 * Human label for a reporting period. An open-ended period reads as "ongoing"
 * rather than showing a blank end date, which reviewers read as missing data.
 */
export function periodLabel(period: Pick<CRMCampaignRoiPeriod, "periodStart" | "periodEnd">): string {
  if (!period.periodStart) return "Unscheduled";
  if (!period.periodEnd) return `${period.periodStart} → ongoing`;
  return `${period.periodStart} → ${period.periodEnd}`;
}

/**
 * Periods oldest-first so the breakdown reads as a spend timeline. The service
 * already sorts, but a caller merging pages should not depend on that.
 */
export function orderPeriods(periods: CRMCampaignRoiPeriod[]): CRMCampaignRoiPeriod[] {
  return [...periods].sort((a, b) => (a.periodStart ?? "").localeCompare(b.periodStart ?? ""));
}
