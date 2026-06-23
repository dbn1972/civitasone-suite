import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatCard, StatGrid, StatusPill, EmptyState } from "../../../_components/ds";
import { getRTIApplications } from "../../../_data/loaders";

const TODAY = new Date().toISOString().slice(0, 10);

export default async function Page() {
  const { data: rtis, source } = await getRTIApplications();

  const pendingReply = rtis.filter((r) => r.status === "received" || r.status === "under_review" || r.status === "forwarded").length;
  const overdue = rtis.filter((r) => r.deadlineDate != null && r.deadlineDate < TODAY && r.status !== "replied" && r.status !== "closed").length;
  const replied = rtis.filter((r) => r.status === "replied").length;
  const appeals = rtis.filter((r) => r.isFirstAppeal).length;

  return (
    <>
      <PageHeader
        title="RTI Applications"
        subtitle="RTI applications, 30-day response tracking &amp; transfers."
        actions={
          <>
            <button className="btn ghost">PIO list</button>
            <button className="btn primary">+ Register RTI</button>
          </>
        }
      />
      {source === "error" && <DataSourceBadge source={source} />}
      <StatGrid>
        <StatCard icon="📄" iconBg="#e0f5fa" label="RTI Applications" value={rtis.length.toLocaleString("en-IN")} />
        <StatCard icon="⏱" iconBg="#fffaeb" label="Due (30-day)" value={pendingReply.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Replied" value={replied.toLocaleString("en-IN")} />
        <StatCard icon="⚖️" iconBg="#eff6ff" label="Appeals" value={appeals.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card">
        <div className="card-h">
          <h3>Application List</h3>
          <div className="seg"><span className="on">All</span><span>Due</span><span>Overdue</span></div>
        </div>
        {rtis.length === 0 ? (
          <EmptyState icon="📄" title="No RTI applications" message="Applications filed under RTI Act 2005 will appear here." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>RTI No</th>
                <th>Applicant</th>
                <th>Subject</th>
                <th>Public Authority</th>
                <th>Filed</th>
                <th>Deadline</th>
                <th>Status</th>
                <th>1st Appeal?</th>
              </tr>
            </thead>
            <tbody>
              {rtis.map((r) => {
                const isOverdue = r.deadlineDate != null && r.deadlineDate < TODAY && r.status !== "replied" && r.status !== "closed";
                return (
                  <tr key={r.id} className={isOverdue ? "bad" : undefined}>
                    <td><span style={{ fontFamily: "monospace" }}>{r.rtiNo}</span></td>
                    <td>{r.applicantName}</td>
                    <td style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.subject}</td>
                    <td>{r.publicAuthority ?? "—"}</td>
                    <td>{r.filedDate ? r.filedDate.slice(0, 10) : "—"}</td>
                    <td style={isOverdue ? { color: "var(--bad)" } : {}}>
                      {r.deadlineDate ? r.deadlineDate.slice(0, 10) : "—"}
                    </td>
                    <td><StatusPill status={r.status} label={r.status.replace(/_/g, " ")} /></td>
                    <td>{r.isFirstAppeal ? "Yes" : "No"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
