/**
 * Pure helpers for the account health screens.
 *
 * The recommendation-service owns scoring and banding; nothing here recomputes a
 * score. These helpers only summarise the watchlist and make the payload
 * presentable, so they stay testable without rendering or fetching.
 */
import type { AccountHealthEntry, CRMAccountSummary, HealthBand } from "@civitasone/types";

export const BAND_LABEL: Record<HealthBand, string> = {
  critical: "Critical",
  at_risk: "At risk",
  healthy: "Healthy",
  thriving: "Thriving",
};

/** Human labels for the five scoring signals returned in a breakdown. */
export const SIGNAL_LABEL: Record<string, string> = {
  productUsage: "Product usage",
  engagement: "Engagement",
  supportBurden: "Support burden",
  paymentTimeliness: "Payment timeliness",
  relationshipDepth: "Relationship depth",
};

export function signalLabel(signal: string): string {
  return SIGNAL_LABEL[signal] ?? signal;
}

export interface WatchlistSummary {
  total: number;
  critical: number;
  atRisk: number;
  /** Mean score across the watchlist, rounded to the nearest integer. */
  averageScore: number;
  /** Lowest-scoring account, the one to call first. */
  worst: AccountHealthEntry | null;
}

/**
 * Headline numbers for the watchlist. `worst` breaks ties on account id so the
 * "call this account first" suggestion does not move between reloads.
 */
export function summariseWatchlist(entries: AccountHealthEntry[]): WatchlistSummary {
  if (entries.length === 0) {
    return { total: 0, critical: 0, atRisk: 0, averageScore: 0, worst: null };
  }

  let critical = 0;
  let atRisk = 0;
  let scoreTotal = 0;
  let worst = entries[0];

  for (const entry of entries) {
    if (entry.band === "critical") critical += 1;
    if (entry.band === "at_risk") atRisk += 1;
    scoreTotal += entry.score;
    if (entry.score < worst.score
      || (entry.score === worst.score && entry.accountId < worst.accountId)) {
      worst = entry;
    }
  }

  return {
    total: entries.length,
    critical,
    atRisk,
    averageScore: Math.round(scoreTotal / entries.length),
    worst,
  };
}

export interface NamedAccountHealthEntry extends AccountHealthEntry {
  accountName: string;
}

/**
 * Attaches account names to watchlist rows.
 *
 * The health endpoint returns account ids only — names live in crm-service, and
 * a cross-service join is not available to us. The web layer therefore reads
 * both lists and joins them here. An id with no matching account still renders,
 * labelled as unknown, because dropping it would silently hide an at-risk
 * account from the very screen meant to surface it.
 */
export function withAccountNames(
  entries: AccountHealthEntry[],
  accounts: CRMAccountSummary[],
): NamedAccountHealthEntry[] {
  const nameById = new Map(accounts.map((a) => [a.id, a.name]));
  return entries.map((entry) => ({
    ...entry,
    accountName: nameById.get(entry.accountId) ?? "Unknown account",
  }));
}

/**
 * Orders watchlist rows by urgency: lowest score first, then account name so the
 * table order is stable.
 */
export function byUrgency(entries: NamedAccountHealthEntry[]): NamedAccountHealthEntry[] {
  return [...entries].sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    return a.accountName.localeCompare(b.accountName);
  });
}
