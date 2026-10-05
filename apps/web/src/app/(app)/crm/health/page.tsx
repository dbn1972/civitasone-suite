import { getTranslations } from "next-intl/server";
import { Card, PageHeader, RefreshErrorState, StatCard, StatGrid } from "../../../_components/ds";
import { getAccountHealthWatchlist, getCrmAccounts } from "../../../_data/loaders";
import { byUrgency, summariseWatchlist, withAccountNames } from "./health";
import { WatchlistTable } from "./WatchlistTable";

// GAP-CRM-HEALTH-02: the watchlist loader requests at this cap. When the API
// returns exactly this many rows the list is (probably) truncated, so counts
// and the average describe only the first `WATCHLIST_CAP` at-risk accounts.
const WATCHLIST_CAP = 100;

export default async function AccountHealthPage() {
  const t = await getTranslations("crm.health");
  const tErr = await getTranslations("crmAccountHealth");
  const [{ data: watchlist, source: healthSource }, { data: accounts, source: accountSource }] =
    await Promise.all([getAccountHealthWatchlist(), getCrmAccounts()]);

  // Account names come from crm-service while scores come from
  // recommendation-service, so the join happens here rather than in either API.
  const source = healthSource === "error" || accountSource === "error" ? "error" : "api";

  // GAP-CRM-HEALTH-01 (FAILMASK): on a failed load the watchlist loader returns
  // [], which the summary turned into Critical=0 / At risk=0 and the table
  // rendered as "Every scored account is currently healthy or thriving" — a
  // false all-clear on the one screen whose entire job is to surface risk. Fail
  // closed instead: show an explicit retry state and render NO zeros and NO
  // "healthy" table. A legitimately empty API result is still a real empty list
  // (handled below), not an error.
  if (source === "error") {
    return (
      <>
        <PageHeader
          title={t("title")}
          subtitle={t("subtitle")}
          back="/crm"
          actions={<a className="btn" href="/crm/accounts">{t("allAccounts")}</a>}
        />
        <RefreshErrorState
          error={{
            what: tErr("loadErrorWhat"),
            next: tErr("loadErrorNext"),
            actions: ["retry", "back"],
          }}
          backHref="/crm"
        />
      </>
    );
  }

  const summary = summariseWatchlist(watchlist);
  const entries = byUrgency(withAccountNames(watchlist, accounts, (id) => tErr("unresolvedAccount", { id })));
  // GAP-CRM-HEALTH-03: "Call First" prefers the worst-scoring account that has a
  // resolved name, so a row whose account could not be looked up never shows as
  // a bare, unidentifiable suggestion. Falls back to the worst entry (with its
  // id-suffix label) only if every at-risk account is unresolved.
  const worstEntry = summary.worst
    ? entries.find((e) => e.accountId === summary.worst?.accountId)
    : undefined;
  const callFirst = entries.find((e) => !e.unresolved) ?? worstEntry;
  const worstName = callFirst?.accountName ?? "—";

  // GAP-CRM-HEALTH-02: the list is capped; when it comes back full, say so.
  const truncated = watchlist.length >= WATCHLIST_CAP;

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/crm"
        actions={<a className="btn" href="/crm/accounts">{t("allAccounts")}</a>}
      />
      <StatGrid>
        {/* GAP-CRM-HEALTH-06: use the StatCard `tone` prop (theme tokens that
            follow dark mode) instead of hard-coded light-pastel hex iconBg
            values, which stayed pale/illegible in dark mode. */}
        <StatCard
          icon="🚨"
          tone="bad"
          label={t("critical")}
          value={summary.critical.toLocaleString("en-IN")}
        />
        <StatCard
          icon="⚠️"
          tone="warn"
          label={t("atRisk")}
          value={summary.atRisk.toLocaleString("en-IN")}
        />
        <StatCard
          icon="📉"
          tone="info"
          label={t("averageScore")}
          value={summary.total > 0 ? `${summary.averageScore}/100` : "—"}
        />
        <StatCard icon="📞" tone="neutral" label={t("callFirst")} value={worstName} />
      </StatGrid>

      <Card title={t("watchlist")}>
        {truncated && (
          <p style={{ fontSize: 13, color: "var(--ink2)", margin: "4px 16px 0" }}>
            {t("truncated", { count: WATCHLIST_CAP })}
          </p>
        )}
        <WatchlistTable entries={entries} />
      </Card>
    </>
  );
}
