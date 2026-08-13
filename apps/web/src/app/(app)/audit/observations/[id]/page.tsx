import Link from "next/link";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, EmptyState } from "../../../../_components/ds";
import { formatMoney, formatIndianDate } from "@/lib/formatters";
import { getAuditObservationById } from "../../../../_data/loaders";
import { ObservationActions } from "./ObservationActions";
import { RepliesTable, StepsTable, type ReplyRow, type StepRow } from "./ObservationTables";

export default async function AuditObservationDetailPage({ params }: { params: { id: string } }) {
  const { data: obs, source } = await getAuditObservationById(params.id);

  if (!obs) {
    return (
      <main className="wrap">
        <Link href="/audit/observations" className="back">← Back</Link>
        <EmptyState icon="🔍" title="Observation not found" message="This observation may have been removed or the ID is invalid." />
      </main>
    );
  }

  const replyRows: ReplyRow[] = obs.replies.map((r) => ({ ...r } as ReplyRow));

  const stepRows: StepRow[] = [
    { step: "Observation raised", by: "Audit", status: "Done" },
    { step: "Auditee reply (ATN)", by: obs.department ?? "Dept", status: obs.replies.length > 0 ? "Received" : "Pending" },
    { step: "Audit committee review", by: "ACO", status: "—" },
    { step: "Closure / recovery", by: "—", status: "—" },
  ];

  return (
    <main className="wrap">
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
        actions={<ObservationActions obsId={obs.id} department={obs.department} />}
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="grid g-main" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Details</h3></div>
            <div className="fields">
              <div className="fld"><div className="l">Auditee</div><div className="v">{obs.department ?? "—"}</div></div>
              <div className="fld"><div className="l">Finding</div><div className="v">{obs.title}</div></div>
              {obs.amount != null && <div className="fld"><div className="l">Money value</div><div className="v">{formatMoney(obs.amount)}</div></div>}
              <div className="fld"><div className="l">Risk</div><div className="v">{obs.severity}</div></div>
              <div className="fld"><div className="l">Raised</div><div className="v">{formatIndianDate(obs.raisedDate)}</div></div>
              {obs.dueDate && <div className="fld"><div className="l">Reply due</div><div className="v">{formatIndianDate(obs.dueDate)}</div></div>}
              {obs.auditPeriod && <div className="fld"><div className="l">Audit period</div><div className="v">{obs.auditPeriod}</div></div>}
              {obs.para && <div className="fld"><div className="l">Para no.</div><div className="v">{obs.para}</div></div>}
            </div>
          </div>
          {obs.replies.length > 0 ? (
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
              <li className="done"><div className="t">Raised</div><div className="d">{formatIndianDate(obs.raisedDate)}</div></li>
              <li className={obs.replies.length > 0 ? "done" : "cur"}><div className="t">Reply / ATN</div><div className="d"></div></li>
              <li className="todo"><div className="t">Committee review</div><div className="d"></div></li>
              <li className="todo"><div className="t">Closure</div><div className="d"></div></li>
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
}
