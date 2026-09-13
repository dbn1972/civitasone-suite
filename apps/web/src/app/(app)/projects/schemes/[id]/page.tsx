import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, StatusPill, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { SchemeProjectsTable, type SchemeProjectRow } from "./SchemeProjectsTable";
import { getSchemeDetail } from "../../../../_data/loaders";
import { useResource } from "@/app/_data/useResource";
import { formatMoney } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";

// COMP-016: this page used to look up `SCHEMES[id] ?? DEFAULT_SCHEME` from an
// 11-entry hardcoded catalogue and never called a loader at all. It now
// fetches the real per-tenant scheme (and its real linked-project list) via
// getSchemeDetail(id), the detail counterpart to the already-real
// getSchemes() the sibling /projects/schemes list page uses.
//
// nodalOfficer, department, beneficiaries, and the scheme's start/end dates
// are rendered as "--" rather than deleted or invented: none of the five has
// a backing column anywhere in project-service's schema today (verified
// directly against scheme/schema.ts and project/schema.ts). Whether to add
// them (new columns/migration) or drop them from the UI for good is a
// product/schema decision, tracked open in the COMP-016 row of
// docs/ENTERPRISE-GAP-REPORT-2026-09-07.md -- not something this fix decides
// unilaterally in either direction.
export default async function SchemeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getSchemeDetail(id);
  const resource = useResource(result, (data) => data === null);

  if (resource.status === "error") {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Scheme" back="/projects/schemes" backLabel="Back to Schemes" />
        <RefreshErrorState error={toHumanError("load", { area: "scheme" })} />
      </main>
    );
  }

  if (resource.status === "empty" || !resource.data) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <PageHeader title="Scheme" back="/projects/schemes" backLabel="Back to Schemes" />
        <EmptyState
          icon="🏛️"
          title="Scheme not found"
          message="This scheme does not exist, or you do not have access to it."
        />
      </main>
    );
  }

  const scheme = resource.data;
  const rows: SchemeProjectRow[] = scheme.projects.map((p) => ({
    name: p.name,
    code: p.code,
    status: p.status,
    budget: p.budgetMinor,
  }));

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, marginBottom: 4 }}>
        <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", gap: 6 }}>
          <li><Link href="/projects">Projects</Link></li>
          <li aria-hidden="true">›</li>
          <li><Link href="/projects/schemes">Schemes</Link></li>
          <li aria-hidden="true">›</li>
          <li aria-current="page" style={{ color: "var(--muted)" }}>{scheme.name}</li>
        </ol>
      </nav>
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
        <StatCard icon="📈" iconBg="#fffaeb" label="Utilized %" value={`${scheme.utilisationPct}%`} />
        {/* Beneficiaries: no backing column anywhere in project-service's schema -- see file header comment. */}
        <StatCard icon="👥" iconBg="#f1f5f9" label="Beneficiaries" value="—" />
      </StatGrid>

      <Card title="Scheme Details" padding>
        <dl style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: "10px 16px", fontSize: 14, margin: 0 }}>
          <dt style={{ fontWeight: 500, color: "var(--muted)" }}>Scheme Code</dt>
          <dd style={{ margin: 0 }}>{scheme.schemeCode}</dd>
          {/* Department, Nodal Officer, Start Date, End Date: no backing column -- see file header comment. */}
          <dt style={{ fontWeight: 500, color: "var(--muted)" }}>Department</dt>
          <dd style={{ margin: 0 }}>—</dd>
          <dt style={{ fontWeight: 500, color: "var(--muted)" }}>Nodal Officer</dt>
          <dd style={{ margin: 0 }}>—</dd>
          <dt style={{ fontWeight: 500, color: "var(--muted)" }}>Funding Pattern</dt>
          <dd style={{ margin: 0 }}>{scheme.fundingPattern}</dd>
          <dt style={{ fontWeight: 500, color: "var(--muted)" }}>Sanction Ref</dt>
          <dd style={{ margin: 0 }}>{scheme.sanctionRef ?? "—"}</dd>
          <dt style={{ fontWeight: 500, color: "var(--muted)" }}>Released</dt>
          <dd style={{ margin: 0 }}>{formatMoney(scheme.releasedMinor)}</dd>
          <dt style={{ fontWeight: 500, color: "var(--muted)" }}>Start Date</dt>
          <dd style={{ margin: 0 }}>—</dd>
          <dt style={{ fontWeight: 500, color: "var(--muted)" }}>End Date</dt>
          <dd style={{ margin: 0 }}>—</dd>
        </dl>
      </Card>

      <Card title="Linked Projects">
        {rows.length === 0 ? (
          <EmptyState icon="🗂️" title="No linked projects" message="No projects have been linked to this scheme yet." />
        ) : (
          <SchemeProjectsTable rows={rows} />
        )}
      </Card>
    </main>
  );
}
