import Link from "next/link";
import { PageHeader, Card, StatusPill, EmptyState, RefreshErrorState } from "../../../../../_components/ds";
import { getSrnByGrn, getProcurementGRNById } from "../../../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { SignSrnAction } from "./SignSrnAction";

export default async function SrnDetailPage({ params }: { params: { id: string } }) {
  const [{ data: srn, source: srnSource, status: srnStatus }, { data: grn }] = await Promise.all([
    getSrnByGrn(params.id),
    getProcurementGRNById(params.id),
  ]);

  // GAP-PROCUREMENT-GRN-DETAIL-SRN-01 — a failed SRN fetch must NOT read as
  // "no SRN yet": fetchJson returns {data:null, source:'error', status} on any
  // non-2xx/network/invalid payload, which is indistinguishable from a genuine
  // "none" unless we check the source. A 500/timeout here, treated as absence,
  // would offer "Create SRN" and let the clerk raise a duplicate for a GRN that
  // may already have a signed SRN gating payment. Only treat a real 404 (or an
  // API 200 with null) as "no SRN".
  const srnUnavailable = !srn && srnSource === "error" && srnStatus !== 404;

  if (srnUnavailable) {
    return (
      <>
        <PageHeader title="Store Receipt Note" subtitle={grn?.grnNo} back={`/procurement/grn/${params.id}`} />
        <RefreshErrorState
          error={toHumanError("load", { area: "Store Receipt Note" })}
          backHref={`/procurement/grn/${params.id}`}
        />
      </>
    );
  }

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

  // GAP-PROCUREMENT-GRN-DETAIL-SRN-02 — show a name when the API supplies one;
  // otherwise an "Officer (…last6)" hint with the full id in a tooltip rather
  // than a bare UUID.
  const officerDisplay = srn.storeOfficerName
    ?? (srn.storeOfficerId && srn.storeOfficerId !== "—"
      ? `Officer (…${srn.storeOfficerId.slice(-6)})`
      : "—");

  return (
    <>
      <PageHeader
        title="Store Receipt Note"
        subtitle={grn?.grnNo}
        back={`/procurement/grn/${params.id}`}
        actions={
          <>
            <StatusPill status={srn.status} label={srn.status === "signed" ? "Signed" : "Draft"} />
            {srn.status === "draft" ? (
              <SignSrnAction
                srnId={srn.id}
                grnNo={grn?.grnNo}
                vendor={grn?.vendor}
                receivedAt={srn.receivedAt}
              />
            ) : null}
          </>
        }
      />

      <Card title="SRN details" padding>
        <div className="fields">
          <div className="field">
            <span className="label">GRN</span>
            {/* GAP-PROCUREMENT-GRN-DETAIL-SRN-04 — link back to the GRN detail. */}
            <Link href={`/procurement/grn/${params.id}`} className="mono">{grn?.grnNo ?? srn.grnId}</Link>
          </div>
          <div className="field">
            <span className="label">Store officer</span>
            <span title={srn.storeOfficerId !== "—" ? srn.storeOfficerId : undefined}>{officerDisplay}</span>
          </div>
          <div className="field">
            <span className="label">Received date</span>
            {/* GAP-PROCUREMENT-GRN-DETAIL-SRN-02 — a draft has no received date
                until it is signed; say so rather than a bare "—". */}
            <span>{srn.receivedAt ? formatIndianDate(srn.receivedAt) : "Pending — set on signing"}</span>
          </div>
          <div className="field">
            <span className="label">Status</span>
            {/* GAP-PROCUREMENT-GRN-DETAIL-SRN-04 — tone tokens, not hard-coded hex. */}
            <span style={{ color: srn.status === "signed" ? "var(--good, #16a34a)" : "var(--warn, #b45309)", fontWeight: 600 }}>
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
