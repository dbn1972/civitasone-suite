import { PageHeader, StatGrid, StatCard, Card, StatusPill, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { SchemeProjectsTable, type SchemeProjectRow } from "./SchemeProjectsTable";
import { getSchemeDetail } from "../../../../_data/loaders";
import { toResourceState } from "@/app/_data/useResource";
import { formatMoney, formatIndianDate, formatPercent } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";

// COMP-016: this page used to look up `SCHEMES[id] ?? DEFAULT_SCHEME` from an
// 11-entry hardcoded catalogue and never called a loader at all. It now
// fetches the real per-tenant scheme (and its real linked-project list) via
// getSchemeDetail(id), the detail counterpart to the already-real
// getSchemes() the sibling /projects/schemes list page uses.
//
// COMP-016 follow-up (migration 0021): nodalOfficer, department,
// beneficiaries and the scheme's start/end dates were rendered as "--"
// because none of the five had a backing column anywhere in
// project-service's schema — deliberately left as an open product/schema
// decision rather than resolved unilaterally in either direction. That
// decision is now: add the columns. All five are still genuinely optional
// (existing schemes predate the migration and have no value for any of
// them), so each one falls back to the same honest "--" exactly when
// getSchemeDetail() omits it — never a fabricated value.
export default async function SchemeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getSchemeDetail(id);
  const resource = toResourceState(result, (data) => data === null);

  if (resource.status === "error") {
    return (
      <div className="page-main wrap">
        <PageHeader title="Scheme" back="/projects/schemes" backLabel="Back to Schemes" />
        <RefreshErrorState error={toHumanError("load", { area: "scheme" })} backHref="/projects/schemes" />
      </div>
    );
  }

  if (resource.status === "empty" || !resource.data) {
    return (
      <div className="page-main wrap">
        <PageHeader title="Scheme" back="/projects/schemes" backLabel="Back to Schemes" />
        <EmptyState
          icon="🏛️"
          title="Scheme not found"
          message="This scheme does not exist, or you do not have access to it."
        />
      </div>
    );
  }

  const scheme = resource.data;
  const rows: SchemeProjectRow[] = scheme.projects.map((p) => ({
    id: p.id,
    name: p.name,
    code: p.code,
    status: p.status,
    budget: p.budgetMinor,
  }));

  return (
    <div className="page-main wrap">
      {/* GAP-PROJECTS-SCHEMES-DETAIL-03: a hand-built inline breadcrumb used to
          render here in addition to the PageHeader back link below, giving two
          wayfinding controls for the same step. Removed the inline breadcrumb;
          PageHeader's back="/projects/schemes" is the single affordance. */}
      <PageHeader
        title={scheme.name}
        subtitle={`Scheme code: ${scheme.schemeCode}`}
        back="/projects/schemes"
        backLabel="Back to Schemes"
        actions={<StatusPill status={scheme.status} />}
      />

      <StatGrid>
        <StatCard icon="📋" iconBg="#eff6ff" label="Total Projects" value={scheme.projects.length} />
        <StatCard icon="💰" iconBg="#ecfdf3" label="Budget" value={formatMoney(scheme.totalOutlayMinor)} />
        <StatCard icon="📈" iconBg="#fffaeb" label="Utilized %" value={formatPercent(scheme.utilisationPct)} />
        {/* != null, not ??: a recorded-but-zero beneficiary count (0) is a
            real value, not an absent one, and must not fall back to "--". */}
        <StatCard
          icon="👥" iconBg="#f1f5f9" label="Beneficiaries"
          value={scheme.beneficiaries != null ? scheme.beneficiaries.toLocaleString("en-IN") : "—"}
        />
      </StatGrid>

      <Card title="Scheme Details" padding>
        <dl style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: "10px 16px", fontSize: 14, margin: 0 }}>
          <dt style={{ fontWeight: 500, color: "var(--muted)" }}>Scheme Code</dt>
          <dd style={{ margin: 0 }}>{scheme.schemeCode}</dd>
          <dt style={{ fontWeight: 500, color: "var(--muted)" }}>Department</dt>
          <dd style={{ margin: 0 }}>{scheme.department ?? "—"}</dd>
          <dt style={{ fontWeight: 500, color: "var(--muted)" }}>Nodal Officer</dt>
          <dd style={{ margin: 0 }}>{scheme.nodalOfficer ?? "—"}</dd>
          <dt style={{ fontWeight: 500, color: "var(--muted)" }}>Funding Pattern</dt>
          <dd style={{ margin: 0 }}>{scheme.fundingPattern}</dd>
          <dt style={{ fontWeight: 500, color: "var(--muted)" }}>Sanction Ref</dt>
          <dd style={{ margin: 0 }}>{scheme.sanctionRef ?? "—"}</dd>
          <dt style={{ fontWeight: 500, color: "var(--muted)" }}>Released</dt>
          <dd style={{ margin: 0 }}>{formatMoney(scheme.releasedMinor)}</dd>
          <dt style={{ fontWeight: 500, color: "var(--muted)" }}>Start Date</dt>
          <dd style={{ margin: 0 }}>{formatIndianDate(scheme.startDate)}</dd>
          <dt style={{ fontWeight: 500, color: "var(--muted)" }}>End Date</dt>
          <dd style={{ margin: 0 }}>{formatIndianDate(scheme.endDate)}</dd>
        </dl>
      </Card>

      <Card title="Linked Projects">
        {rows.length === 0 ? (
          <EmptyState icon="🗂️" title="No linked projects" message="No projects have been linked to this scheme yet." />
        ) : (
          <SchemeProjectsTable rows={rows} />
        )}
      </Card>
    </div>
  );
}
