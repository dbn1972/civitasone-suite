import { getTranslations } from "next-intl/server";
import { Card, PageHeader, RefreshErrorState, StatCard, StatGrid } from "../../../_components/ds";
import { getAccountHealthWatchlist, getCrmAccounts } from "../../../_data/loaders";
import { BAND_LABEL, byUrgency, summariseWatchlist, withAccountNames } from "./health";
import { WatchlistTable } from "./WatchlistTable";

export default async function AccountHealthPage() {
  const t = await getTranslations("crmAccountHealth");
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
            what: t("loadErrorWhat"),
            next: t("loadErrorNext"),
            actions: ["retry", "back"],
          }}
          backHref="/crm"
        />
      </>
    );
  }

  const summary = summariseWatchlist(watchlist);
  const entries = byUrgency(withAccountNames(watchlist, accounts));
  const worstName = summary.worst
    ? entries.find((e) => e.accountId === summary.worst?.accountId)?.accountName ?? "—"
    : "—";

  return (
    <>
      <PageHeader
        title={t("title")}
        subtitle={t("subtitle")}
        back="/crm"
        actions={<a className="btn" href="/crm/accounts">{t("allAccounts")}</a>}
      />
      <StatGrid>
        <StatCard
          icon="🚨"
          iconBg="#fee2e2"
          label={BAND_LABEL.critical}
          value={summary.critical.toLocaleString("en-IN")}
        />
        <StatCard
          icon="⚠️"
          iconBg="#fef3c7"
          label={BAND_LABEL.at_risk}
          value={summary.atRisk.toLocaleString("en-IN")}
        />
        <StatCard
          icon="📉"
          iconBg="#e0f2fe"
          label="Average Score"
          value={summary.total > 0 ? `${summary.averageScore}/100` : "—"}
        />
        <StatCard icon="📞" iconBg="#fce7f3" label="Call First" value={worstName} />
      </StatGrid>

      <Card title="Watchlist">
        <WatchlistTable entries={entries} />
      </Card>
    </>
  );
}
