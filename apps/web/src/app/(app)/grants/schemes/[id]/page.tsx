import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader, Card, StatGrid, StatCard, StatusPill, RefreshErrorState, ProgressBar } from "@/app/_components/ds";
import { formatMoney, formatIndianDate, formatPercent, percentOfMinor } from "@/lib/formatters";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { toHumanError } from "@/lib/messages";
import { getSchemeById } from "../../_data";
import { GRANTS_MAKER_ROLES } from "../../roles";
import { schemeWindowState } from "../../schemeWindow";
import { CloseSchemeButton } from "./CloseSchemeButton";

export default async function SchemeDetailPage({ params }: { params: { id: string } }) {
  const { data: scheme, source, status } = await getSchemeById(params.id);

  // GAP-GRANTS-SCHEMES-DETAIL-03: a network/5xx failure must show a retry state,
  // NOT "Page not found". notFound() is reserved for a genuine 404 from the API.
  if (source === "error" && status !== 404) {
    return (
      <>
        <PageHeader back="/grants/schemes" backLabel="Schemes" title="Scheme" />
        <RefreshErrorState
          error={toHumanError("load", { area: "scheme" })}
          backHref="/grants/schemes"
          source={{ status, area: "scheme" }}
        />
      </>
    );
  }
  if (!scheme) {
    notFound();
  }

  // GAP-GRANTS-SCHEMES-DETAIL-01: management actions are maker-only.
  const canMaintain = hasAnyRole(getSessionRoles(), GRANTS_MAKER_ROLES);

  // GAP-GRANTS-SCHEMES-DETAIL-05: respect the window, not just status==="open".
  const window = schemeWindowState(scheme);
  const accepting = window.accepting;

  // GAP-GRANTS-SCHEMES-DETAIL-04: real budget-vs-disbursed utilisation.
  const utilisationPct = percentOfMinor(scheme.disbursedMinor, scheme.budgetMinor);
  const remainingMinor = Math.max(scheme.budgetMinor - scheme.disbursedMinor, 0);

  function applyButton() {
    if (accepting) {
      return (
        <Link href={`/grants/schemes/${params.id}/apply`} className="btn primary">
          + New Application
        </Link>
      );
    }
    // Not accepting: show a disabled control with the reason, never a live CTA.
    const note =
      window.accepting === false && window.reason === "before-open" && window.at
        ? `Opens ${formatIndianDate(window.at)}`
        : window.accepting === false && window.reason === "after-close" && window.at
          ? `Closed ${formatIndianDate(window.at)}`
          : "Not accepting applications";
    return (
      <button type="button" className="btn" disabled aria-disabled="true" title={note}>
        {note}
      </button>
    );
  }

  return (
    <>
      <PageHeader
        back="/grants/schemes"
        backLabel="Schemes"
        title={scheme.name}
        subtitle={scheme.code}
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <StatusPill status={scheme.status} />
            {/* GAP-GRANTS-SCHEMES-DETAIL-06: a single "+ New Application" entry
                (header only); the duplicate in Management Actions was removed. */}
            {canMaintain && applyButton()}
          </div>
        }
      />

      <StatGrid>
        <StatCard icon="💰" iconBg="#ecfdf5" label="Total Budget" value={formatMoney(scheme.budgetMinor)} />
        <StatCard icon="📤" iconBg="#dbeafe" label="Disbursed" value={formatMoney(scheme.disbursedMinor)} />
        <StatCard icon="🧮" iconBg="#f1f5f9" label="Remaining" value={formatMoney(remainingMinor)} />
        <StatCard icon="📈" iconBg="#fef3c7" label="Utilisation" value={formatPercent(utilisationPct)} />
      </StatGrid>

      {/* GAP-GRANTS-SCHEMES-DETAIL-04: budget-vs-disbursed bar (replaces dead
          utilizationPct = 0). */}
      <Card title="Budget Utilisation" padding>
        <ProgressBar value={utilisationPct ?? 0} />
        <p style={{ fontSize: 13, color: "var(--ink2)", marginTop: 8 }}>
          {formatMoney(scheme.disbursedMinor)} disbursed of {formatMoney(scheme.budgetMinor)} budget
          {utilisationPct != null ? ` (${formatPercent(utilisationPct)})` : ""}.
        </p>
      </Card>

      <Card title="Scheme Details" padding>
        <dl className="fields">
          <div>
            <dt className="lab">Code</dt>
            <dd style={{ fontFamily: "monospace" }}>{scheme.code}</dd>
          </div>
          <div>
            <dt className="lab">Status</dt>
            <dd><StatusPill status={scheme.status} /></dd>
          </div>
          <div>
            <dt className="lab">Currency</dt>
            <dd>{scheme.currency}</dd>
          </div>
          <div>
            <dt className="lab">Min Amount</dt>
            <dd>{scheme.minAmountMinor > 0 ? formatMoney(scheme.minAmountMinor) : "No minimum"}</dd>
          </div>
          <div>
            <dt className="lab">Max Amount</dt>
            <dd>{formatMoney(scheme.maxAmountMinor)}</dd>
          </div>
          <div>
            <dt className="lab">Opens</dt>
            <dd>{scheme.openAt ? formatIndianDate(scheme.openAt) : "—"}</dd>
          </div>
          <div>
            <dt className="lab">Closes</dt>
            <dd>{scheme.closeAt ? formatIndianDate(scheme.closeAt) : "—"}</dd>
          </div>
          {/* GAP-GRANTS-SCHEMES-DETAIL-06: `&&` on a numeric 0 printed a stray
              "0" — guard with an explicit > 0 check. */}
          {scheme.reportingFrequencyDays != null && scheme.reportingFrequencyDays > 0 && (
            <div>
              <dt className="lab">Reporting Cycle</dt>
              <dd>
                {scheme.reportingFrequencyDays === 90 && "Quarterly (90 days)"}
                {scheme.reportingFrequencyDays === 180 && "Half-yearly (180 days)"}
                {scheme.reportingFrequencyDays === 365 && "Annual (365 days)"}
                {![90, 180, 365].includes(scheme.reportingFrequencyDays) && `${scheme.reportingFrequencyDays} days`}
              </dd>
            </div>
          )}
          {scheme.sanctionRef && (
            <div>
              <dt className="lab">Sanction Ref</dt>
              <dd>{scheme.sanctionRef}</dd>
            </div>
          )}
        </dl>
      </Card>

      <Card title="Management Actions" padding>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {canMaintain && (scheme.status === "draft" || scheme.status === "open") && (
            <CloseSchemeButton schemeId={params.id} schemeName={scheme.name} />
          )}
          <Link href="/grants/applications" className="btn">
            View Applications
          </Link>
        </div>
      </Card>
    </>
  );
}
