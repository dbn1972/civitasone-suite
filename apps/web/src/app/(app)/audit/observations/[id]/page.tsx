import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, EmptyState, LoadErrorState, RefreshErrorState } from "../../../../_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { getAuditObservationById } from "../../../../_data/loaders";
import { severityMeta, statusMeta } from "@/lib/audit/observationLabels";
import { deriveWorkflow, stepClass } from "@/lib/audit/observationWorkflow";
import { getSessionRoles, hasAnyRole, AUDIT_OBSERVATION_REPLY_ROLES, AUDIT_OBSERVATION_REFER_ROLES, AUDIT_OBSERVATION_REVIEW_ROLES } from "@/lib/auth/roleGuard";
import { toHumanError } from "@/lib/messages";
import { ObservationActions } from "./ObservationActions";
import { RepliesTable, StepsTable, type ReplyRow, type StepRow } from "./ObservationTables";
import { ArrowLeft } from "lucide-react";

export default async function AuditObservationDetailPage({ params }: { params: { id: string } }) {
  const { data: obs, source, status } = await getAuditObservationById(params.id);

  // GAP-AUDIT-OBSERVATIONS-DETAIL-03: tell "not found" apart from an outage.
  if (source === "error" || !obs) {
    if (status === 404) notFound();
    if (status === 403) {
      return (
        <div className="wrap">
          <Link href="/audit/observations" className="back"><ArrowLeft aria-hidden="true" size={14} /> Back</Link>
          <LoadErrorState result={{ status: 403 }} area="this observation" backHref="/audit/observations" />
        </div>
      );
    }
    return (
      <div className="wrap">
        <Link href="/audit/observations" className="back"><ArrowLeft aria-hidden="true" size={14} /> Back</Link>
        <RefreshErrorState error={toHumanError("load", { area: "this observation" })} backHref="/audit/observations" />
      </div>
    );
  }

  // GAP-AUDIT-OBSERVATIONS-DETAIL-06: never call .map on a possibly-absent array.
  const replies = obs.replies ?? [];
  const replyRows: ReplyRow[] = replies.map((r) => ({ ...r } as ReplyRow));

  // GAP-AUDIT-OBSERVATIONS-DETAIL-01: derive step state from the real status.
  const workflow = deriveWorkflow(obs.status, replies.length > 0);
  const sev = severityMeta(obs.severity);
  const st = statusMeta(obs.status);

  // GAP-AUDIT-OBSERVATIONS-DETAIL-02: compute action permissions server-side.
  // Refer (draft para) is invalid once the observation is closed. Server
  // re-enforces; this only hides/disables controls the user cannot use.
  const roles = getSessionRoles();
  const canReply = hasAnyRole(roles, AUDIT_OBSERVATION_REPLY_ROLES) && obs.status !== "closed";
  const canRefer = hasAnyRole(roles, AUDIT_OBSERVATION_REFER_ROLES) && obs.status !== "closed";
  // GAP-AUDIT-OBSERVATIONS-DETAIL-05: accepting/rejecting the compliance reply
  // is restricted to the review authority and only valid while the
  // observation is 'replied'. Server re-enforces both.
  const canReview = hasAnyRole(roles, AUDIT_OBSERVATION_REVIEW_ROLES);

  const stepRows: StepRow[] = [
    { step: "Observation raised", by: "Audit", status: "Done" },
    { step: "Auditee reply (ATN)", by: obs.department ?? "Dept", status: replies.length > 0 ? "Received" : "Pending" },
    {
      step: "Audit committee review",
      by: "Not tracked",
      status: workflow[2].state === "done" ? "Done" : workflow[2].state === "current" ? "In review" : "—",
    },
    {
      step: "Closure / recovery",
      by: "Not tracked",
      status: workflow[3].state === "done" ? "Done" : workflow[3].state === "current" ? "In progress" : "—",
    },
  ];

  return (
    <div className="wrap">
      <nav aria-label="Breadcrumb" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 4 }}>
        <Link href="/audit/dashboard" className="lnk">Audit</Link>
        <span aria-hidden="true" style={{ margin: "0 7px", color: "var(--line)" }}>/</span>
        <Link href="/audit/observations" className="lnk">Observations</Link>
        <span aria-hidden="true" style={{ margin: "0 7px", color: "var(--line)" }}>/</span>
        <span aria-current="page">{obs.observationNo}</span>
      </nav>
      <PageHeader
        back="/audit/observations"
        title={`${obs.observationNo} · ${obs.department ?? "—"}`}
        actions={<ObservationActions obsId={obs.id} department={obs.department} status={obs.status} canReply={canReply} canRefer={canRefer} canReview={canReview} />}
      />
      {/* GAP-AUDIT-OBSERVATIONS-DETAIL-04: status + risk pills, identical to the list row. */}
      <div style={{ display: "flex", gap: 8, margin: "4px 0 14px" }}>
        <span className={`pill ${st.pill}`}>{st.label}</span>
        <span className={`pill ${sev.pill}`}>{sev.label} risk</span>
      </div>
      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Details</h3></div>
            <div className="fields">
              <div className="fld"><div className="l">Auditee</div><div className="v">{obs.department ?? "—"}</div></div>
              <div className="fld"><div className="l">Finding</div><div className="v">{obs.title}</div></div>
              {obs.amount != null && <div className="fld"><div className="l">Money value</div><div className="v">{formatMoney(obs.amount)}</div></div>}
              {/* GAP-AUDIT-OBSERVATIONS-DETAIL-05: risk via the shared label, not the raw enum. */}
              <div className="fld"><div className="l">Risk</div><div className="v"><span className={`pill ${sev.pill}`}>{sev.label}</span></div></div>
              <div className="fld"><div className="l">Status</div><div className="v"><span className={`pill ${st.pill}`}>{st.label}</span></div></div>
              <div className="fld"><div className="l">Raised</div><div className="v">{formatIndianDate(obs.raisedDate)}</div></div>
              {obs.dueDate && <div className="fld"><div className="l">Reply due</div><div className="v">{formatIndianDate(obs.dueDate)}</div></div>}
              {obs.auditPeriod && <div className="fld"><div className="l">Audit period</div><div className="v">{obs.auditPeriod}</div></div>}
              {obs.para && <div className="fld"><div className="l">Para no.</div><div className="v">{obs.para}</div></div>}
            </div>
          </div>
          {replies.length > 0 ? (
            <div className="card">
              <div className="card-h"><h3>Replies</h3></div>
              <RepliesTable rows={replyRows} />
            </div>
          ) : (
            <div className="card">
              <div className="card-h"><h3>Replies</h3></div>
              <EmptyState icon="💬" title="No replies yet" message="Auditee reply (ATN) will appear here once submitted." />
            </div>
          )}
          <div className="card">
            <div className="card-h"><h3>Action &amp; compliance</h3></div>
            <StepsTable rows={stepRows} />
          </div>
        </div>
        <div className="card">
          <div className="card-h"><h3>Workflow</h3></div>
          <div className="pad">
            <ul className="tl">
              {workflow.map((s) => (
                <li key={s.key} className={stepClass(s.state)}>
                  <div className="t">{s.label}</div>
                  <div className="d">{s.key === "raised" ? formatIndianDate(obs.raisedDate) : ""}</div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
