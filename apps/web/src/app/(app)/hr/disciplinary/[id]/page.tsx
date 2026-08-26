import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, Card, StatCard, StatGrid, StatusPill, EmptyState } from "@/app/_components/ds";
import { getDisciplinaryCaseById } from "@/app/_data/loaders";
import { RaiseEOfficeNote } from "@/app/_components/RaiseEOfficeNote";

function field(data: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = data[key];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return "—";
}

export default async function DisciplinaryCaseDetailPage({ params }: { params: { id: string } }) {
  const { data: dcase, source } = await getDisciplinaryCaseById(params.id);

  if (!dcase) {
    return (
      <main className="page-main wrap" aria-labelledby="page-heading">
        <nav aria-label="Breadcrumb" className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
          <a href="/hr">HR</a> <span aria-hidden="true">›</span>{" "}
          <a href="/hr/vigilance">Disciplinary</a> <span aria-hidden="true">›</span> Not found
        </nav>
        <PageHeader title="Disciplinary Case" back="/hr/vigilance" />
        <EmptyState icon="📁" title="Case not found" message="This disciplinary case may have been removed or the ID is invalid." />
      </main>
    );
  }

  const caseNo = field(dcase, "caseNo", "case_no");
  const status = field(dcase, "status");
  const proceedingType = field(dcase, "proceedingType", "proceeding_type");
  const allegation = field(dcase, "allegation");
  const penaltyType = field(dcase, "penaltyType", "penalty_type");
  const finding = field(dcase, "finding");
  const caseLabel = caseNo !== "—" ? caseNo : params.id;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <nav aria-label="Breadcrumb" className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
        <a href="/hr">HR</a> <span aria-hidden="true">›</span>{" "}
        <a href="/hr/vigilance">Disciplinary</a> <span aria-hidden="true">›</span>{" "}
        <span aria-current="page">{caseLabel}</span>
      </nav>

      <PageHeader
        title={`Disciplinary case ${caseLabel}`}
        subtitle={proceedingType !== "—" ? `${proceedingType} proceeding` : undefined}
        back="/hr/vigilance"
        actions={<StatusPill status={status} />}
      />
      <DataSourceBadge source={source} message="Couldn't load — showing nothing" />

      <StatGrid>
        <StatCard icon="📋" iconBg="#eff6ff" label="Status" value={status.replace(/_/g, " ")} />
        <StatCard icon="⚖️" iconBg="#faf5ff" label="Proceeding" value={proceedingType} />
        <StatCard icon="🔎" iconBg="#fff7ed" label="Finding" value={finding} />
        <StatCard icon="🚫" iconBg="#fef2f2" label="Penalty" value={penaltyType} />
      </StatGrid>

      <Card title="Case details" padding>
        <div className="fields">
          <div className="field"><span className="label">Case No</span><span className="mono">{caseNo}</span></div>
          <div className="field"><span className="label">Proceeding Type</span><span>{proceedingType}</span></div>
          <div className="field"><span className="label">Finding</span><span>{finding}</span></div>
          <div className="field"><span className="label">Penalty</span><span>{penaltyType}</span></div>
          <div className="field"><span className="label">Status</span><StatusPill status={status} /></div>
          {allegation !== "—" && (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span className="label">Allegation</span>
              <span style={{ whiteSpace: "pre-wrap" }}>{allegation}</span>
            </div>
          )}
        </div>
      </Card>

      <RaiseEOfficeNote
        refType="hr_disciplinary"
        refId={params.id}
        subject={`Disciplinary case ${caseLabel}`}
        dept="HR"
        defaultApprovalChain="file_noting"
        notifyPath={`/api/proxy/v1/hrms/disciplinary/${params.id}/submit-approval`}
      />
    </main>
  );
}
