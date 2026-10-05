"use client";
import { useTranslations } from "next-intl";
import { DataTable, StatusPill } from "../../../_components/ds";
import { BAND_LABEL, type NamedAccountHealthEntry } from "./health";

type WatchlistRow = {
  accountId: string;
  accountName: string;
  score: number;
  band: string;
  computedAt: string;
};

/**
 * GAP-CRM-HEALTH-04: the table's strings are translated (crm.health namespace),
 * and the empty-state copy no longer hard-codes "falls to 50 or below" — the
 * at-risk threshold is owned by recommendation-service and the client has no
 * threshold constant, so quoting a number here would go stale if banding
 * changes. useTranslations throws without a provider, so (like DataTable) we
 * fall back to the English literals when no NextIntlClientProvider is present,
 * which keeps every page/test that doesn't wrap one working unchanged.
 */
function useSafeT(namespace: string, fallback: Record<string, string>): (key: string) => string {
  try {
    return useTranslations(namespace);
  } catch {
    return (key: string) => fallback[key] ?? key;
  }
}

const BAND_FALLBACK: Record<string, string> = {
  band_critical: "Critical",
  band_at_risk: "At risk",
  band_healthy: "Healthy",
  band_thriving: "Thriving",
};

const FALLBACK: Record<string, string> = {
  columnAccount: "Account",
  columnBand: "Band",
  columnScore: "Health Score",
  columnLastScored: "Last Scored",
  filterPlaceholder: "Filter by account…",
  emptyTitle: "No accounts at risk",
  emptyMessage: "Accounts appear here once they are scored at risk or critical.",
  bandLabel: "Health band",
};

function formatDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function WatchlistTable({ entries }: { entries: NamedAccountHealthEntry[] }) {
  const t = useSafeT("crm.health", FALLBACK);
  const tBand = useSafeT("crmWatchlistTable", BAND_FALLBACK);
  const bandText = (band: string): string =>
    band in BAND_LABEL ? tBand(`band_${band}`) : band;
  const rows: WatchlistRow[] = entries.map((entry) => ({
    accountId: entry.accountId,
    accountName: entry.accountName,
    score: entry.score,
    band: entry.band,
    computedAt: entry.computedAt,
  }));

  return (
    <DataTable<WatchlistRow>
      columns={[
        { key: "accountName", label: t("columnAccount") },
        {
          key: "band",
          label: t("columnBand"),
          render: (row) => (
            // Text label on the pill is a non-colour cue; the aria-label names
            // it as the health band for screen readers.
            <span aria-label={`${t("bandLabel")}: ${bandText(row.band)}`}>
              <StatusPill status={BAND_LABEL[row.band as keyof typeof BAND_LABEL] ?? row.band} label={bandText(row.band)} />
            </span>
          ),
        },
        { key: "score", label: t("columnScore"), align: "right", render: (row) => `${row.score}/100` },
        { key: "computedAt", label: t("columnLastScored"), render: (row) => formatDate(row.computedAt) },
      ]}
      rows={rows}
      rowHref={(row) => `/crm/health/${row.accountId}`}
      sortable
      filterable
      filterPlaceholder={t("filterPlaceholder")}
      exportable
      exportFilename="account-health-watchlist"
      emptyIcon="💚"
      emptyTitle={t("emptyTitle")}
      emptyMessage={t("emptyMessage")}
    />
  );
}
