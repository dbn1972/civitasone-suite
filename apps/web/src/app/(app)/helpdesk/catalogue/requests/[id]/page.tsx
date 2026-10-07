import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, StatusPill, RefreshErrorState } from "../../../../../_components/ds";
import { getServiceRequest, getCatalogueOffering } from "../../../../../_data/loaders";
import { formatIndianDate } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";
import { SlaBadge } from "../../../SlaBadge";

/**
 * GAP-HELPDESK-CATALOGUE-MY-REQUESTS-02: a request-detail page so the
 * requester can see the rejection reason, stage history and deadline without
 * being limited to the list's summary row. Also the anchor for a future
 * Cancel action (pending_approval requests) once the backend supports it.
 */
export default async function Page({ params }: { params: { id: string } }) {
  const { data: req, source, status } = await getServiceRequest(params.id);

  if (source === "error" && status !== 404) {
    return (
      <div className="wrap">
        <PageHeader title="Request details" back="/helpdesk/catalogue/my-requests" backLabel="My Requests" />
        <RefreshErrorState error={toHumanError("load", { area: "request details" })} backHref="/helpdesk/catalogue/my-requests" />
      </div>
    );
  }
  if (!req) notFound();

  // Load offering details for names (best-effort, no crash on failure)
  const { data: offering } = await getCatalogueOffering(req.offeringId);

  const ref = `SR-${req.id.slice(0, 8).toUpperCase()}`;

  const STATUS_LABEL: Record<string, string> = {
    pending_approval: "Pending approval",
    approved: "Approved",
    rejected: "Rejected",
    pending_fulfilment: "Pending fulfilment",
    in_fulfilment: "In fulfilment",
    fulfilled: "Fulfilled",
    cancelled: "Cancelled",
  };

  return (
    <div className="wrap">
      <PageHeader
        title={offering?.name ?? "Service request"}
        subtitle={`Request ${ref}`}
        back="/helpdesk/catalogue/my-requests"
        backLabel="My Requests"
      />

      <div className="card pad">
        <div className="fields">
          <div className="fld"><div className="fl">Reference</div><div className="fv">{ref}</div></div>
          <div className="fld"><div className="fl">Status</div><div className="fv"><StatusPill status={req.status} label={STATUS_LABEL[req.status] ?? req.status} /></div></div>
          <div className="fld"><div className="fl">SLA</div><div className="fv"><SlaBadge status={req.slaStatus} /></div></div>
          <div className="fld"><div className="fl">Current stage</div><div className="fv">{req.currentStage ?? "—"}</div></div>
          <div className="fld"><div className="fl">Resolution deadline</div><div className="fv">{req.resolutionDeadline ? formatIndianDate(req.resolutionDeadline) : "—"}</div></div>
          <div className="fld"><div className="fl">Raised</div><div className="fv">{formatIndianDate(req.createdAt)}</div></div>
          {req.rejectionReason ? (
            <div className="fld" style={{ gridColumn: "1 / -1" }}>
              <div className="fl">Rejection reason</div>
              <div className="fv">{req.rejectionReason}</div>
            </div>
          ) : null}
        </div>
      </div>

      {req.stageHistory && req.stageHistory.length > 0 ? (
        <div className="card pad" style={{ marginTop: 16 }}>
          <div className="card-h"><h3>Stage history</h3></div>
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>
            {req.stageHistory.map((e, i) => (
              <li key={i} style={{ fontSize: "0.875rem", marginBottom: 6 }}>
                <strong>{e.stage}</strong> — {formatIndianDate(e.enteredAt)}
                {e.note ? <> — {e.note}</> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
        {req.ticketId ? (
          <Link href={`/helpdesk/tickets/${req.ticketId}`} className="btn ghost" style={{ minHeight: 40 }}>View ticket</Link>
        ) : null}
        <Link href="/helpdesk/catalogue/my-requests" className="btn ghost" style={{ minHeight: 40 }}>Back to My Requests</Link>
      </div>
    </div>
  );
}
