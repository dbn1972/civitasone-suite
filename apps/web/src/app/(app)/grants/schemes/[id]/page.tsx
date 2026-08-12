import { notFound } from "next/navigation";
import Link from "next/link";
import { PageHeader, Card, StatGrid, StatCard, StatusPill, EmptyState } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { getSchemeById } from "../../_data";

const SECTOR_LABELS: Record<string, string> = {
  agriculture: "Agriculture", education: "Education", health: "Health",
  infrastructure: "Infrastructure", social: "Social", other: "Other",
};

export default async function SchemeDetailPage({ params }: { params: { id: string } }) {
  const { data: scheme, source } = await getSchemeById(params.id);

  if (!scheme) {
    notFound();
  }

  const utilizationPct = scheme.budgetMinor > 0 ? 0 : 0; // disbursed not in this view yet
  const isOpen = scheme.status === "open";

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/grants">Grants</a>{" "}
        <span aria-hidden="true">/</span>{" "}
        <a href="/grants/schemes">Schemes</a>{" "}
        <span aria-hidden="true">/</span>{" "}
        <span aria-current="page">{scheme.code}</span>
      </nav>

      <PageHeader
        back="/grants/schemes"
        backLabel="Schemes"
        title={scheme.name}
        subtitle={scheme.code}
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <StatusPill status={scheme.status} />
            {source === "error" && <DataSourceBadge source="error" />}
            {isOpen && (
              <Link href={`/grants/schemes/${params.id}/apply`} className="btn primary">
                + New Application
              </Link>
            )}
          </div>
        }
      />

      <StatGrid>
        <StatCard
          icon="💰"
          iconBg="#ecfdf5"
          label="Total Budget"
          value={formatMoney(scheme.budgetMinor)}
        />
        <StatCard
          icon="⬆️"
          iconBg="#dbeafe"
          label="Max Grant"
          value={formatMoney(scheme.maxAmountMinor)}
        />
        <StatCard
          icon="📅"
          iconBg="#f1f5f9"
          label="Opens"
          value={scheme.openAt ? formatIndianDate(scheme.openAt) : "—"}
        />
        <StatCard
          icon="🔒"
          iconBg="#fef3c7"
          label="Closes"
          value={scheme.closeAt ? formatIndianDate(scheme.closeAt) : "—"}
        />
      </StatGrid>

      <Card title="Scheme Details" padding>
        <dl className="fields">
          <div>
            <dt className="lab">Code</dt>
            <dd style={{ fontFamily: "monospace" }}>{scheme.code}</dd>
          </div>
          <div>
            <dt className="lab">Name</dt>
            <dd>{scheme.name}</dd>
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
            <dt className="lab">Total Budget</dt>
            <dd>{formatMoney(scheme.budgetMinor)}</dd>
          </div>
          <div>
            <dt className="lab">Min Amount</dt>
            <dd>{scheme.minAmountMinor > 0 ? formatMoney(scheme.minAmountMinor) : "No minimum"}</dd>
          </div>
          <div>
            <dt className="lab">Max Amount</dt>
            <dd>{formatMoney(scheme.maxAmountMinor)}</dd>
          </div>
          {scheme.reportingFrequencyDays && (
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
          {scheme.openAt && (
            <div>
              <dt className="lab">Opens At</dt>
              <dd>{formatIndianDate(scheme.openAt)}</dd>
            </div>
          )}
          {scheme.closeAt && (
            <div>
              <dt className="lab">Closes At</dt>
              <dd>{formatIndianDate(scheme.closeAt)}</dd>
            </div>
          )}
        </dl>
      </Card>

      <Card title="Management Actions" padding>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {isOpen && (
            <Link href={`/grants/schemes/${params.id}/apply`} className="btn primary">
              + New Application
            </Link>
          )}
          {(scheme.status === "draft" || isOpen) && (
            <form action={`/api/proxy/v1/grants/schemes/${params.id}/close`} method="POST">
              <button
                type="submit"
                className="btn"
                style={{ color: "var(--bad)" }}
              >
                Close Scheme
              </button>
            </form>
          )}
          <Link href="/grants/applications" className="btn">
            View Applications
          </Link>
        </div>
      </Card>
    </>
  );
}
