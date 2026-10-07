import Link from "next/link";
import { PageHeader, Card, StatCard, StatGrid, StatusPill, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getLegalOpinionById } from "@/app/_data/loaders";
import { RaiseEOfficeNote } from "@/app/_components/RaiseEOfficeNote";
import { toHumanError } from "@/lib/messages";

function field(data: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = data[key];
    if (typeof v === "string" && v.length > 0) return v;
    if (typeof v === "number") return String(v);
  }
  return "—";
}

export default async function LegalOpinionDetailPage({ params }: { params: { id: string } }) {
  const { data: opinion, source, status } = await getLegalOpinionById(params.id);

  // GAP-LEGAL-OPINIONS-DETAIL-02: an outage (5xx / 401 / network) must NOT read
  // as "this opinion was deleted". Only a successful null or a real 404 is a
  // genuine not-found; any other error source shows a retryable error state.
  if (source === "error" && status !== 404) {
    return (
      <>
        <nav aria-label="Breadcrumb" className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
          <Link href="/legal">Legal</Link> <span aria-hidden="true">›</span>{" "}
          <Link href="/legal/opinions">Opinions</Link>
        </nav>
        <PageHeader title="Legal Opinion" back="/legal/opinions" />
        <RefreshErrorState error={toHumanError("load", { area: "legal opinion" })} backHref="/legal/opinions" />
      </>
    );
  }

  if (!opinion) {
    return (
      <>
        <nav aria-label="Breadcrumb" className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
          <Link href="/legal">Legal</Link> <span aria-hidden="true">›</span>{" "}
          <Link href="/legal/opinions">Opinions</Link> <span aria-hidden="true">›</span> Not found
        </nav>
        <PageHeader title="Legal Opinion" back="/legal/opinions" />
        <EmptyState icon="⚖️" title="Opinion not found" message="This legal opinion may have been removed or the ID is invalid." />
      </>
    );
  }

  const opinionNo = field(opinion, "opinionNo", "opinion_no");
  const subject = field(opinion, "subject");
  const status_ = field(opinion, "status");
  // GAP-LEGAL-OPINIONS-DETAIL-04: accept BOTH the detail and the list field
  // names so the page is not blank if the API uses the list vocabulary
  // (counselName vs advisorName, soughtBy vs requestedBy).
  const counsel = field(opinion, "counselName", "counsel_name", "advisorName");
  const soughtBy = field(opinion, "soughtBy", "sought_by", "requestedBy");
  const question = field(opinion, "question");
  const title = opinionNo !== "—" ? opinionNo : (subject !== "—" ? subject : "Legal Opinion");

  return (
    <>
      <nav aria-label="Breadcrumb" className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
        <Link href="/legal">Legal</Link> <span aria-hidden="true">›</span>{" "}
        <Link href="/legal/opinions">Opinions</Link> <span aria-hidden="true">›</span>{" "}
        <span aria-current="page">{title}</span>
      </nav>

      <PageHeader
        title={title}
        subtitle={subject !== "—" ? subject : undefined}
        back="/legal/opinions"
        actions={<StatusPill status={status_} />}
      />

      {/* GAP-LEGAL-OPINIONS-DETAIL-04: Status is shown ONCE (the header pill).
          The redundant Status stat card and Status detail row were removed. */}
      <StatGrid>
        <StatCard icon="👤" iconBg="#faf5ff" label="Counsel" value={counsel} />
        <StatCard icon="🙋" iconBg="#fff7ed" label="Sought By" value={soughtBy} />
      </StatGrid>

      <Card title="Opinion details" padding>
        <div className="fields">
          <div className="field"><span className="label">Opinion No</span><span className="mono">{opinionNo}</span></div>
          <div className="field"><span className="label">Subject</span><span>{subject}</span></div>
          <div className="field"><span className="label">Counsel</span><span>{counsel}</span></div>
          <div className="field"><span className="label">Sought By</span><span>{soughtBy}</span></div>
          {question !== "—" && (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span className="label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                Question
                {/* GAP-LEGAL-OPINIONS-DETAIL-04: legal advice is privileged;
                    mark it so it is not treated as freely shareable. */}
                <span className="pill warn" style={{ fontSize: "0.7rem" }}>Privileged &amp; confidential</span>
              </span>
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
