import { getTranslations } from "next-intl/server";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { Card, EmptyState, PageHeader, StatCard, StatGrid, StatusPill, HelpTip, LoadErrorState } from "../../../../_components/ds";
import { getAccountHealthBreakdown, getCrmAccounts } from "../../../../_data/loaders";
import { SIGNAL_LABEL, signalLabel } from "../health";
import { FollowUpModal } from "./FollowUpModal";

interface PageProps {
  params: { accountId: string };
}

function formatDateTime(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * GAP-CRM-HEALTH-ACCOUNTID-01: the breakdown payload carries no account name,
 * so the page title was a fixed "Account Health" and the follow-up dialog
 * labelled the account with its raw UUID — a clerk could not confirm WHICH
 * account they were about to raise a service request against. Account names
 * live in crm-service (not recommendation-service), so we resolve the name here
 * from the existing accounts list and fall back to a short id if the lookup
 * fails or the account is unknown.
 */
function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

export default async function AccountHealthDetailPage({ params }: PageProps) {
  const [breakdownResult, { data: accounts }] = await Promise.all([
    getAccountHealthBreakdown(params.accountId),
    getCrmAccounts(),
  ]);
  const { data: breakdown, source } = breakdownResult;

  const t = await getTranslations("crmAccountHealthDetail");
  const accountName = accounts.find((a) => a.id === params.accountId)?.name ?? null;

  // GAP-CRM-HEALTH-ACCOUNTID-02: a fetch failure is not a scoring gap. Only a
  // real 404 (or a successful null body) means "not scored yet"; a network/5xx/
  // 403 gets the status-aware retry/permission state, and the follow-up action
  // is hidden (there is no account state to act on).
  if (!breakdown && source === "error" && breakdownResult.status !== 404) {
    return (
      <>
        <PageHeader
          title={accountName ?? t("titleWithId", { id: shortId(params.accountId) })}
          back="/crm/health"
        />
        <LoadErrorState result={breakdownResult} area="account health" backHref="/crm/health" />
      </>
    );
  }

  if (!breakdown) {
    return (
      <>
        <PageHeader
          title={accountName ?? t("titleWithId", { id: shortId(params.accountId) })}
          back="/crm/health"
          actions={<FollowUpModal accountId={params.accountId} accountName={accountName} />}
        />
        {source === "error" && <DataSourceBadge source={source} />}
        <Card>
          <EmptyState
            icon="📊"
            title={t("noScoreTitle")}
            message={t("noScoreMessage")}
            action={<a className="btn" href="/crm/health">{t("backToWatchlist")}</a>}
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={accountName ?? t("titleWithId", { id: shortId(breakdown.accountId) })}
        subtitle={t("scored", { when: formatDateTime(breakdown.computedAt) })}
        back="/crm/health"
        actions={
          <>
            <FollowUpModal accountId={breakdown.accountId} accountName={accountName} />
            <a className="btn" href={`/crm/accounts/${breakdown.accountId}`}>{t("viewAccount")}</a>
          </>
        }
      />
      <StatGrid>
        <StatCard icon="❤️" iconBg="#fee2e2" label={t("healthScore")} value={`${breakdown.score}/100`} />
        <StatCard icon="🏷️" iconBg="#e0f2fe" label={t("band")} value={t(`band_${breakdown.band}`)} />
        <StatCard
          icon="🧮"
          iconBg="#fef3c7"
          label={t("signalsUsed")}
          value={breakdown.contributingFactors.length.toLocaleString("en-IN")}
        />
        <StatCard icon="🔁" iconBg="#dcfce7" label={t("version")} value={String(breakdown.version)} />
      </StatGrid>

      <Card title={t("contributingSignals")}>
        {breakdown.contributingFactors.length === 0 ? ( // ux-001-ok: `breakdown` is only reachable past the earlier `if (!breakdown) return` guard above (source==="error" implies a null breakdown per the loader contract) -- this is a genuinely signal-free stored score, never a masked fetch failure
          <EmptyState
            icon="🧮"
            title={t("noSignalsTitle")}
            message={t("noSignalsMessage")}
          />
        ) : (
          // Deliberately a plain table, not DataTable: this is a fixed,
          // short explanation of how one score was composed. Sorting, filtering
          // and CSV export would be noise on a five-row breakdown, and reordering
          // the rows would obscure the weighting narrative.
          <table className="tbl">
            <caption className="sr-only">
              {t("signalsCaption")}
            </caption>
            <thead>
              <tr>
                <th scope="col">{t("colSignal")}</th>
                <th scope="col" style={{ textAlign: "end" }}>{t("colValue")}</th>
                <th scope="col" style={{ textAlign: "end" }}>{t("colWeight")}</th>
                <th scope="col" style={{ textAlign: "end" }}>{t("colContribution")}</th>
                <th scope="col">
                  {/* GAP-CRM-HEALTH-ACCOUNTID-05: "Clamped" is specialist jargon.
                      A HelpTip explains, in plain words, that it means the raw
                      signal was outside its allowed range and capped for scoring. */}
                  <span style={{ display: "inline-flex", alignItems: "center" }}>
                    {t("colDataQuality")}
                    <HelpTip term={t("clamped")}>
                      {t("clampedHelp")}
                    </HelpTip>
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              {breakdown.contributingFactors.map((factor) => (
                <tr key={factor.signal}>
                  <td>{factor.signal in SIGNAL_LABEL ? t(`signal_${factor.signal}`) : signalLabel(factor.signal)}</td>
                  <td style={{ textAlign: "end" }}>{factor.value}</td>
                  <td style={{ textAlign: "end" }}>{Math.round(factor.weight * 100)}%</td>
                  {/* GAP-CRM-HEALTH-ACCOUNTID-05: contribution is points toward the
                      composite 0-100 score; label the unit so a bare number is not
                      ambiguous. A positive value is prefixed with "+". */}
                  <td style={{ textAlign: "end" }}>
                    {t("contributionPts", { value: factor.contribution > 0 ? `+${factor.contribution}` : String(factor.contribution) })}
                  </td>
                  <td>
                    {factor.clamped
                      ? <StatusPill status="Clamped" label={t("clamped")} />
                      : <StatusPill status="Reported" label={t("reported")} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {breakdown.storedScore !== breakdown.score && (
        <Card title={t("recomputedTitle")}>
          <p style={{ padding: "12px 16px", margin: 0, color: "#475569", fontSize: 13 }}>
            {t("recomputedBody", { stored: breakdown.storedScore, score: breakdown.score })}
          </p>
        </Card>
      )}
    </>
  );
}
