import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { Card, PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getAccountHealthWatchlist, getCrmAccounts } from "../../../_data/loaders";
import { BAND_LABEL, byUrgency, summariseWatchlist, withAccountNames } from "./health";
import { WatchlistTable } from "./WatchlistTable";

export default async function AccountHealthPage() {
  const [{ data: watchlist, source: healthSource }, { data: accounts, source: accountSource }] =
    await Promise.all([getAccountHealthWatchlist(), getCrmAccounts()]);

  // Account names come from crm-service while scores come from
  // recommendation-service, so the join happens here rather than in either API.
  const source = healthSource === "error" || accountSource === "error" ? "error" : "api";
  const summary = summariseWatchlist(watchlist);
  const entries = byUrgency(withAccountNames(watchlist, accounts));
  const worstName = summary.worst
    ? entries.find((e) => e.accountId === summary.worst?.accountId)?.accountName ?? "—"
    : "—";

  return (
    <>
      <PageHeader
        title="Account Health"
        subtitle="Accounts scored at risk or critical, ordered by urgency."
        back="/crm"
        actions={<a className="btn" href="/crm/accounts">All Accounts</a>}
      />
      {source === "error" && <DataSourceBadge source={source} />}
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
