import { notFound } from "next/navigation";
import { PageHeader, Card, StatGrid, StatCard, StatusPill } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { maskLast4 } from "@/app/_components/ds/Masked";
import { formatMoney, humanizeStatus } from "@/lib/formatters";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { GRANTS_MAKER_ROLES } from "../../roles";
import { getGranteeById } from "@/app/_data/loaders";

const TYPE_LABELS: Record<string, string> = {
  individual: "Individual",
  institution: "Institution",
  society: "Society",
  mission: "Mission",
};

/**
 * GAP-GRANTS-GRANTEES-04: a grantee detail route so the registry rows are
 * traceable (the list now links here). Shows the grantee's own fields;
 * registration/PAN identifiers are masked for non-privileged roles (DPDP).
 * There is no by-grantee grants/UCs read endpoint in grant-service yet, so the
 * grants/UCs section honestly says it is not available rather than inventing
 * numbers (flagged as a backend follow-up).
 */
export default async function GranteeDetailPage({ params }: { params: { id: string } }) {
  const { data: grantee, source } = await getGranteeById(params.id);

  if (source !== "error" && !grantee) {
    notFound();
  }

  const canViewPii = hasAnyRole(getSessionRoles(), GRANTS_MAKER_ROLES);

  const renderPii = (value: string | null | undefined) => {
    if (!value) return "—";
    return canViewPii ? value : maskLast4(value);
  };

  return (
    <>
      <PageHeader
        back="/grants/grantees"
        backLabel="Grantees"
        title={grantee?.name ?? "Grantee"}
        subtitle={grantee ? TYPE_LABELS[grantee.type] ?? grantee.type : undefined}
        actions={source === "error" ? <DataSourceBadge source="error" /> : grantee ? <StatusPill status={grantee.status} /> : undefined}
      />

      {grantee && (
        <>
          <StatGrid>
            <StatCard icon="👥" iconBg="#faf5ff" label="Type" value={TYPE_LABELS[grantee.type] ?? grantee.type} />
            <StatCard icon="📋" iconBg="#eff6ff" label="Status" value={humanizeStatus(grantee.status)} />
            <StatCard icon="🗺️" iconBg="#f0fdf4" label="Geography" value={grantee.geography ?? "—"} />
            <StatCard
              icon="₹"
              iconBg="#ecfdf5"
              label="Annual income"
              value={grantee.incomeAnnualMinor ? formatMoney(grantee.incomeAnnualMinor) : "—"}
            />
          </StatGrid>

          <Card title="Grantee details" padding>
            <div className="fields">
              <div className="field"><span className="label">Name</span><span>{grantee.name}</span></div>
              <div className="field"><span className="label">Type</span><span>{TYPE_LABELS[grantee.type] ?? grantee.type}</span></div>
              <div className="field"><span className="label">Category</span><span>{grantee.category ?? "—"}</span></div>
              <div className="field"><span className="label">Geography</span><span>{grantee.geography ?? "—"}</span></div>
              <div className="field"><span className="label">Status</span><StatusPill status={grantee.status} /></div>
              <div className="field"><span className="label">Registration No</span><span className="mono">{renderPii(grantee.registrationNo)}</span></div>
              <div className="field"><span className="label">PAN</span><span className="mono">{renderPii(grantee.panNo)}</span></div>
            </div>
          </Card>

          <Card title="Grants & utilisation" padding>
            <p style={{ color: "var(--ink2)" }}>
              A per-grantee breakdown of grants and utilisation certificates is not available yet.
              Use the Grants and Installments pages to trace this grantee&rsquo;s awards.
            </p>
          </Card>
        </>
      )}
    </>
  );
}
