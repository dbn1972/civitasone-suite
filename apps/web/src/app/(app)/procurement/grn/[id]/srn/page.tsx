import Link from "next/link";
import { PageHeader, Card, StatusPill, EmptyState } from "../../../../../_components/ds";
import { getSrnByGrn, getProcurementGRNById } from "../../../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { SignSrnAction } from "./SignSrnAction";

export default async function SrnDetailPage({ params }: { params: { id: string } }) {
  const [{ data: srn }, { data: grn }] = await Promise.all([
    getSrnByGrn(params.id),
    getProcurementGRNById(params.id),
  ]);

  if (!srn) {
    return (
      <>
        <PageHeader title="Store Receipt Note" subtitle={grn?.grnNo} back={`/procurement/grn/${params.id}`} />
        <EmptyState
          icon="📥"
          title="No Store Receipt Note yet"
          message="A signed SRN is required under GFR Rule 149 before payment against this GRN can be authorised."
          action={<Link href={`/procurement/grn/${params.id}/srn/new`} className="btn primary">Create SRN</Link>}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Store Receipt Note"
        subtitle={grn?.grnNo}
        back={`/procurement/grn/${params.id}`}
        actions={
          <>
            <StatusPill status={srn.status} label={srn.status === "signed" ? "Signed" : "Draft"} />
            {srn.status === "draft" ? <SignSrnAction srnId={srn.id} /> : null}
          </>
        }
      />

      <Card title="SRN details" padding>
        <div className="fields">
          <div className="field">
            <span className="label">GRN</span>
            <span className="mono">{grn?.grnNo ?? srn.grnId}</span>
          </div>
          <div className="field">
            <span className="label">Store officer</span>
            <span className="mono">{srn.storeOfficerId}</span>
          </div>
          <div className="field">
            <span className="label">Received date</span>
            <span>{srn.receivedAt ? formatIndianDate(srn.receivedAt) : "—"}</span>
          </div>
          <div className="field">
            <span className="label">Status</span>
            <span style={{ color: srn.status === "signed" ? "#16a34a" : "#b45309", fontWeight: 600 }}>
              {srn.status === "signed" ? "Signed — payment gate cleared" : "Draft — not yet signed"}
            </span>
          </div>
          {srn.remarks ? (
            <div className="field">
              <span className="label">Remarks</span>
              <span>{srn.remarks}</span>
            </div>
          ) : null}
        </div>
      </Card>
    </>
  );
}
