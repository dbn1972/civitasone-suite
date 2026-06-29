import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, Card, StatCard, StatGrid, StatusPill, EmptyState } from "@/app/_components/ds";
import { getLegalOpinionById } from "@/app/_data/loaders";
import { RaiseEOfficeNote } from "@/app/_components/RaiseEOfficeNote";

function field(data: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = data[key];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return "—";
}

export default async function LegalOpinionDetailPage({ params }: { params: { id: string } }) {
  const { data: opinion, source } = await getLegalOpinionById(params.id);

  if (!opinion) {
    return (
      <>
        <nav aria-label="Breadcrumb" className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
          <a href="/legal">Legal</a> <span aria-hidden="true">›</span>{" "}
          <a href="/legal/opinions">Opinions</a> <span aria-hidden="true">›</span> Not found
        </nav>
        <PageHeader title="Legal Opinion" back="/legal/opinions" />
        <EmptyState icon="⚖️" title="Opinion not found" message="This legal opinion may have been removed or the ID is invalid." />
      </>
    );
  }

  const opinionNo = field(opinion, "opinionNo", "opinion_no");
  const subject = field(opinion, "subject");
  const status = field(opinion, "status");
  const counsel = field(opinion, "counselName", "counsel_name");
  const soughtBy = field(opinion, "soughtBy", "sought_by");
  const question = field(opinion, "question");
  const title = opinionNo !== "—" ? opinionNo : (subject !== "—" ? subject : "Legal Opinion");

  return (
    <>
      <nav aria-label="Breadcrumb" className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
        <a href="/legal">Legal</a> <span aria-hidden="true">›</span>{" "}
        <a href="/legal/opinions">Opinions</a> <span aria-hidden="true">›</span>{" "}
        <span aria-current="page">{title}</span>
      </nav>

      <PageHeader
        title={title}
        subtitle={subject !== "—" ? subject : undefined}
        back="/legal/opinions"
        actions={
          <>
            <StatusPill status={status} />
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="📋" iconBg="#eff6ff" label="Status" value={status.replace(/_/g, " ")} />
        <StatCard icon="👤" iconBg="#faf5ff" label="Counsel" value={counsel} />
        <StatCard icon="🙋" iconBg="#fff7ed" label="Sought By" value={soughtBy} />
      </StatGrid>

      <Card title="Opinion details" padding>
        <div className="fields">
          <div className="field"><span className="label">Opinion No</span><span className="mono">{opinionNo}</span></div>
          <div className="field"><span className="label">Subject</span><span>{subject}</span></div>
          <div className="field"><span className="label">Counsel</span><span>{counsel}</span></div>
          <div className="field"><span className="label">Sought By</span><span>{soughtBy}</span></div>
          <div className="field"><span className="label">Status</span><StatusPill status={status} /></div>
          {question !== "—" && (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span className="label">Question</span>
              <span style={{ whiteSpace: "pre-wrap" }}>{question}</span>
            </div>
          )}
        </div>
      </Card>

      <RaiseEOfficeNote
        refType="legal_opinion"
        refId={params.id}
        subject={`Legal opinion — ${subject !== "—" ? subject : title}`}
        dept="Legal"
        defaultApprovalChain="file_noting"
        notifyPath={`/api/proxy/v1/legal/opinions/${params.id}/submit-approval`}
      />
    </>
  );
}
