"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { DataTable, StatusPill } from "../../../_components/ds";
import { getAgents } from "@/lib/crm/assignment";
import { BAND_LABEL, type NamedAccountHealthEntry } from "./health";

type WatchlistRow = {
  accountId: string;
  accountName: string;
  score: number;
  band: string;
  computedAt: string;
  ownerId: string | null;
  ownerName: string;
  lastContactAt: string | null;
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
  columnOwner: "Owner",
  unassigned: "Unassigned",
  unknownUser: "Unknown user",
  columnLastContact: "Last Contact",
  filterPlaceholder: "Filter by account…",
  emptyTitle: "No accounts at risk",
  emptyMessage: "Accounts appear here once they are scored at risk or critical.",
  bandLabel: "Health band",
  logFollowUp: "Log follow-up",
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

  // F5-01: resolve owner ids to display names via the CRM agent directory
  // (never render a raw UUID). A failed load leaves the map empty and the
  // Owner column falls back to "Unassigned"/a short id fragment.
  const [ownerNames, setOwnerNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let cancelled = false;
    const ownerIds = Array.from(
      new Set(entries.map((e) => e.ownerId).filter((v): v is string => typeof v === "string" && v.length > 0)),
    );
    if (ownerIds.length === 0) {
      setOwnerNames(new Map());
      return;
    }
    void getAgents().then(({ data }) => {
      if (cancelled) return;
      const map = new Map<string, string>();
      for (const a of data) map.set(a.agentId, a.name);
      setOwnerNames(map);
    });
    return () => {
      cancelled = true;
    };
  }, [entries]);

  const rows: WatchlistRow[] = entries.map((entry) => ({
    accountId: entry.accountId,
    accountName: entry.accountName,
    score: entry.score,
    band: entry.band,
    computedAt: entry.computedAt,
    ownerId: entry.ownerId,
    ownerName: entry.ownerId
      ? ownerNames.get(entry.ownerId) ?? t("unknownUser")
      : t("unassigned"),
    lastContactAt: entry.lastContactAt,
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
        { key: "ownerId", label: t("columnOwner"), render: (row) => row.ownerName },
        {
          key: "lastContactAt",
          label: t("columnLastContact"),
          render: (row) => (row.lastContactAt ? formatDate(row.lastContactAt) : "—"),
        },
        { key: "computedAt", label: t("columnLastScored"), render: (row) => formatDate(row.computedAt) },
        {
          // GAP-CRM-HEALTH-05: an explicit per-row action to start a follow-up
          // without first drilling into the account. It opens the account's
          // health detail page, which hosts the Create-Follow-up dialog
          // (FollowUpModal → a service request linked to this account). A
          // deep-link straight into a prefilled activity/service-request form is
          // deferred: /crm/service-requests/new has no accountId prefill param
          // and /crm/activities/new does not exist (verified), so linking there
          // would not actually prefill the account. stopPropagation keeps the
          // button click from also triggering the row's rowHref navigation.
          key: "accountId",
          label: "",
          render: (row) => (
            <Link
              href={`/crm/health/${row.accountId}?followUp=1`}
              className="btn"
              style={{ fontSize: 13 }}
              onClick={(e) => e.stopPropagation()}
            >
              {t("logFollowUp")}
            </Link>
          ),
        },
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
