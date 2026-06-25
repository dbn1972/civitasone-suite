import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import Link from "next/link";
import { PageHeader, StatCard, StatusPill } from "../../../_components/ds";
import { getLegalDashboard } from "../../../_data/loaders";

export default async function LegalDashboardPage() {
  const { data, source } = await getLegalDashboard();

  return (
    <div className="wrap">
      <PageHeader
        title="Legal Management"
        subtitle="Court cases, hearings, legal opinions & order compliance."
        actions={
          <>
            <button className="btn ghost">Export</button>
            <Link href="/legal/cases/new" className="btn primary">+ New Case</Link>
          </>
        }
      />
      <div className="grid g-4" style={{ marginBottom: 18 }}>
        <StatCard icon="📁" iconBg="#f1f5f9" label="Active Cases" value={data.activeCases} />
        <StatCard icon="🗓️" iconBg="#eff6ff" label="Hearings (wk)" value={data.hearingsThisWeek} />
        <StatCard icon="📜" iconBg="#fffaeb" label="Orders to Comply" value={data.ordersPending} />
        <StatCard icon="⚠️" iconBg="#fef3f2" label="Adverse Risk" value={data.opinionsDue} />
      </div>
      {source === "error" && <DataSourceBadge source={source} />}
      <div className="grid g-main" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h">
              <h3>Cases overview</h3>
              <div className="seg"><span className="on">All</span><span>High Court</span><span>Tribunals</span></div>
            </div>
            <div className="pad" style={{ color: "#667085", fontSize: 13 }}>
              Active cases: {data.activeCases} &nbsp;·&nbsp; Hearings this week: {data.hearingsThisWeek} &nbsp;·&nbsp; Orders pending: {data.ordersPending}
            </div>
          </div>
          <div className="card">
            <div className="card-h">
              <h3>Upcoming hearings</h3>
              <a className="lnk" href="/legal/hearings">Calendar →</a>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Court</th>
                  <th>Purpose</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={4} style={{ padding: "20px 16px", textAlign: "center", color: "#98a2b3", fontSize: 13 }}>
                    {data.hearingsThisWeek > 0 ? `${data.hearingsThisWeek} hearings scheduled this week` : "No upcoming hearings"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h"><h3>Disposal rate</h3></div>
            <div className="pad" style={{ textAlign: "center", padding: "24px 0" }}>
              <div style={{ fontSize: 36, fontWeight: 800 }}>
                {data.activeCases > 0 ? Math.round((data.activeCases / (data.activeCases + data.opinionsDue)) * 100) : 64}%
              </div>
              <div style={{ fontSize: 12, color: "#98a2b3" }}>disposed</div>
            </div>
          </div>
          <div className="card">
            <div className="card-h"><h3>Action needed</h3><span className="pill warn">{data.ordersPending}</span></div>
            <div className="pad" style={{ color: "#667085", fontSize: 13 }}>
              {data.ordersPending} court orders require compliance action.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
