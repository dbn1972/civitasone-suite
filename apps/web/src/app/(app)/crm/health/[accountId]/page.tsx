import { getTranslations } from "next-intl/server";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { Card, EmptyState, PageHeader, StatCard, StatGrid, StatusPill } from "../../../../_components/ds";
import { getAccountHealthBreakdown, getCrmAccounts } from "../../../../_data/loaders";
import { BAND_LABEL, signalLabel } from "../health";
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
  const [{ data: breakdown, source }, { data: accounts }] = await Promise.all([
    getAccountHealthBreakdown(params.accountId),
    getCrmAccounts(),
  ]);

  const t = await getTranslations("crmAccountHealthDetail");
  const accountName = accounts.find((a) => a.id === params.accountId)?.name ?? null;

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
            title="No health score yet"
            message="This account has not been scored. A score appears once the health signals for it have been collected and a recompute has run."
            action={<a className="btn" href="/crm/health">Back to watchlist</a>}
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={accountName ?? t("titleWithId", { id: shortId(breakdown.accountId) })}
        subtitle={`Scored ${formatDateTime(breakdown.computedAt)}`}
        back="/crm/health"
        actions={
          <>
            <FollowUpModal accountId={breakdown.accountId} accountName={accountName} />
            <a className="btn" href={`/crm/accounts/${breakdown.accountId}`}>View Account</a>
          </>
        }
      />
      <StatGrid>
        <StatCard icon="❤️" iconBg="#fee2e2" label="Health Score" value={`${breakdown.score}/100`} />
        <StatCard icon="🏷️" iconBg="#e0f2fe" label="Band" value={BAND_LABEL[breakdown.band]} />
        <StatCard
          icon="🧮"
          iconBg="#fef3c7"
          label="Signals Used"
          value={breakdown.contributingFactors.length.toLocaleString("en-IN")}
        />
        <StatCard icon="🔁" iconBg="#dcfce7" label="Version" value={String(breakdown.version)} />
      </StatGrid>

      <Card title="Contributing Signals">
        {breakdown.contributingFactors.length === 0 ? ( // ux-001-ok: `breakdown` is only reachable past the earlier `if (!breakdown) return` guard above (source==="error" implies a null breakdown per the loader contract) -- this is a genuinely signal-free stored score, never a masked fetch failure
          <EmptyState
            icon="🧮"
            title="No signals recorded"
            message="The stored score has no signal breakdown, so only the composite score is available for this account."
          />
        ) : (
          // Deliberately a plain table, not DataTable: this is a fixed,
          // short explanation of how one score was composed. Sorting, filtering
          // and CSV export would be noise on a five-row breakdown, and reordering
          // the rows would obscure the weighting narrative.
          <table className="tbl">
            <caption className="sr-only">
              Signals contributing to this account&apos;s health score
            </caption>
            <thead>
              <tr>
                <th scope="col">Signal</th>
                <th scope="col" style={{ textAlign: "end" }}>Value</th>
                <th scope="col" style={{ textAlign: "end" }}>Weight</th>
                <th scope="col" style={{ textAlign: "end" }}>Contribution</th>
                <th scope="col">Data Quality</th>
              </tr>
            </thead>
            <tbody>
              {breakdown.contributingFactors.map((factor) => (
                <tr key={factor.signal}>
                  <td>{signalLabel(factor.signal)}</td>
                  <td style={{ textAlign: "end" }}>{factor.value}</td>
                  <td style={{ textAlign: "end" }}>{Math.round(factor.weight * 100)}%</td>
                  <td style={{ textAlign: "end" }}>{factor.contribution}</td>
                  <td>
                    {factor.clamped
                      ? <StatusPill status="Clamped" />
                      : <StatusPill status="Reported" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {breakdown.storedScore !== breakdown.score && (
        <Card title="Score Recomputed From Signals">
          <p style={{ padding: "12px 16px", margin: 0, color: "#475569", fontSize: 13 }}>
            The stored score for this account is {breakdown.storedScore}, while recomputing from the
            signals above gives {breakdown.score}. The recomputed value is shown so the score, band
            and signals always agree. A recompute will bring the stored value back in line.
          </p>
        </Card>
      )}
    </>
  );
}
