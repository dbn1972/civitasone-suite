import { notFound } from "next/navigation";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatusPill, EmptyState } from "../../../_components/ds";
import { getChangeRequest } from "../_data/loaders";
import { ChangeActions } from "./ChangeActions";
import { formatIndianDate } from "@/lib/formatters";

export default async function Page({ params }: { params: { id: string } }) {
  const { data: detail, source } = await getChangeRequest(params.id);
  if (source === "error") {
    return (
      <>
        <PageHeader title="Change request" back="/change" />
        <DataSourceBadge source={source} />
        <EmptyState icon="⚠️" title="Could not load this change" message="The change service could not be reached." />
      </>
    );
  }
  if (!detail) notFound();
  const c = detail.data;

  const field = (label: string, value: React.ReactNode) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 180 }}>
      <span className="lbl" style={{ color: "#667085", fontSize: 12 }}>{label}</span>
      <span>{value}</span>
    </div>
  );

  return (
    <>
      <PageHeader title={c.title} subtitle={`Change ${c.id.slice(0, 8)} · ${c.type} · ${c.risk} risk`} back="/change" />

      <div className="card">
        <div className="card-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Overview</h3>
          <StatusPill status={c.status} />
        </div>
        <div className="pad" style={{ display: "flex", flexWrap: "wrap", gap: 20 }}>
          {field("Type", c.type)}
          {field("Risk", c.risk)}
          {field("Requested by", c.requestedBy.slice(0, 8))}
          {field("Approved by", c.approvedBy ? c.approvedBy.slice(0, 8) : "—")}
          {field("Affected services", c.affectedServices.join(", ") || "—")}
          {field("Release window", c.windowStart && c.windowEnd
            ? `${formatIndianDate(c.windowStart)} → ${formatIndianDate(c.windowEnd)}`
            : "Not scheduled")}
        </div>
        <div className="pad" style={{ borderTop: "1px solid #eef0f3" }}>
          {field("Description", <span style={{ whiteSpace: "pre-wrap" }}>{c.description}</span>)}
        </div>
        <div className="pad" style={{ borderTop: "1px solid #eef0f3" }}>
          {field("Rollback plan", c.rollbackPlan
            ? <span style={{ whiteSpace: "pre-wrap" }}>{c.rollbackPlan}</span>
            : <span style={{ color: "#b42318" }}>Not captured — required before CAB approval</span>)}
        </div>
        {c.rejectedReason && (
          <div className="pad" style={{ borderTop: "1px solid #eef0f3" }}>
            {field("Rejection reason", <span style={{ color: "#b42318" }}>{c.rejectedReason}</span>)}
          </div>
        )}
        {c.pirOutcome && (
          <div className="pad" style={{ borderTop: "1px solid #eef0f3" }}>
            {field("Post-implementation review", `${c.pirOutcome.replace(/_/g, " ")} — ${c.pirNotes ?? ""}`)}
          </div>
        )}
        {c.releaseNotes && (
          <div className="pad" style={{ borderTop: "1px solid #eef0f3" }}>
            {field("Release notes", <span style={{ whiteSpace: "pre-wrap" }}>{c.releaseNotes}</span>)}
          </div>
        )}
      </div>

      <ChangeActions id={c.id} status={c.status} hasRollbackPlan={Boolean(c.rollbackPlan)} />

      <div className="card">
        <div className="card-h"><h3>Audit trail</h3></div>
        {detail.audit.length === 0 ? (
          <EmptyState icon="🗒️" title="No transitions recorded" />
        ) : (
          <table className="tbl" style={{ width: "100%" }}>
            <thead><tr><th>When</th><th>From</th><th>To</th><th>Actor</th><th>Note</th></tr></thead>
            <tbody>
              {detail.audit.map((a) => (
                <tr key={a.id}>
                  <td>{formatIndianDate(a.at)}</td>
                  <td>{a.fromStatus?.replace(/_/g, " ") ?? "—"}</td>
                  <td><StatusPill status={a.toStatus} /></td>
                  <td>{a.actorId.slice(0, 8)}</td>
                  <td>{a.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
