import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PrintExportButton } from "../../../_components/PrintExportButton";
import Link from "next/link";
import { PageHeader, StatCard, DataTable } from "../../../_components/ds";
import { getLegalDashboard } from "../../../_data/loaders";
import { CasesOverviewSeg } from "./CasesOverviewSeg";

export default async function LegalDashboardPage() {
  const { data, source } = await getLegalDashboard();

  return (
    <div className="wrap">
      <PageHeader
        title="Legal Management"
        subtitle="Court cases, hearings, legal opinions & order compliance."
        actions={
          <>
            <PrintExportButton label="Export" documentTitle="Legal Dashboard" />
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
          <CasesOverviewSeg
            activeCases={data.activeCases}
            hearingsThisWeek={data.hearingsThisWeek}
            ordersPending={data.ordersPending}
          />
          <div className="card">
            <div className="card-h">
              <h3>Upcoming hearings</h3>
              <a className="lnk" href="/legal/hearings">Calendar →</a>
            </div>
            <p className="pad" style={{ color: "#667085", fontSize: 13, margin: 0 }}>
              {data.hearingsThisWeek > 0 ? `${data.hearingsThisWeek} hearings scheduled this week.` : "No hearings scheduled this week."}
            </p>
            <DataTable
              columns={[
                { key: "caseNo", label: "Case" },
                { key: "court", label: "Court" },
                { key: "purpose", label: "Purpose" },
                { key: "status", label: "Status", cellType: "status" },
              ]}
              rows={[]}
            />
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
