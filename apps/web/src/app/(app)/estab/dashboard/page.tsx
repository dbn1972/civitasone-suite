import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getEstabDashboard, getEstabFiles } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, DataTable, EmptyState } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";

type RecentFileRow = {
  id: string;
  fileNo: string;
  subject: string;
  status: string;
  due: string;
};

export default async function EstabDashboardPage() {
  const [{ data, source }, { data: files }] = await Promise.all([
    getEstabDashboard(),
    getEstabFiles(),
  ]);

  const recent = (files ?? []).slice(0, 8);
  const recentRows: RecentFileRow[] = recent.map((f) => ({
    id: f.id,
    fileNo: f.fileNo,
    subject: f.subject,
    status: f.status.replace(/_/g, " "),
    due: formatIndianDate(f.dueDate),
  }));

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="Establishment & Administration"
        subtitle="Integrated eOffice — DAK, noting, multi-hop approval, pendency."
        actions={
          <>
            <Link href="/estab/dak" className="btn ghost">DAK Registry</Link>
            <Link href="/estab/files/new" className="btn primary">+ Create File</Link>
          </>
        }
      />
      <StatGrid>
        <StatCard icon="📁" iconBg="#e6f7f5" label="Active Files" value={data.filesPending.toLocaleString("en-IN")} />
        <StatCard icon="⏱" iconBg="#fef2f2" label="SLA Breached" value={data.slaBreached.toLocaleString("en-IN")} />
        <StatCard icon="📬" iconBg="#eff6ff" label="DAK Pending" value={data.dakPending.toLocaleString("en-IN")} />
        <StatCard icon="📊" iconBg="#fffaeb" label="Avg Pendency (days)" value={String(data.avgPendencyDays)} />
        <StatCard icon="📅" iconBg="#f5f3ff" label="Meetings Today" value={data.meetingsToday.toLocaleString("en-IN")} />
        <StatCard icon="✅" iconBg="#ecfdf5" label="Compliance Due" value={data.complianceItemsDue.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="grid g-main" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h">
              <h3>Recent files (eOffice)</h3>
              <Link className="lnk" href="/estab/list">All files →</Link>
            </div>
            {recentRows.length === 0 ? (
              <EmptyState icon="📁" title="No files yet" message="Register DAK or create a file to get started." />
            ) : (
              <DataTable<RecentFileRow>
                columns={[
                  { key: "fileNo", label: "File No" },
                  { key: "subject", label: "Subject" },
                  { key: "status", label: "Status", cellType: "status" },
                  { key: "due", label: "Due" },
                ]}
                rows={recentRows}
                rowLinkKey="id"
                rowLinkPrefix="/estab/files/"
                sortable
              />
            )}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h">
              <h3>Quick links</h3>
            </div>
            <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
              <Link href="/estab/dak"><span aria-hidden="true">📬</span> DAK / Inward registry</Link>
              <Link href="/estab/approvals"><span aria-hidden="true">✅</span> Noting approval queue (SO → US → DS)</Link>
              <Link href="/estab/dispatch"><span aria-hidden="true">📤</span> Outward dispatch</Link>
              <Link href="/estab/compliance"><span aria-hidden="true">📋</span> Compliance tracker</Link>
            </div>
          </div>
          <div className="card">
            <div className="card-h">
              <h3>Pendency snapshot</h3>
            </div>
            <div className="fields pad">
              <div className="fld"><div className="l">Active files</div><div className="v">{data.filesPending}</div></div>
              <div className="fld"><div className="l">Unlinked DAK</div><div className="v">{data.dakPending}</div></div>
              <div className="fld"><div className="l">SLA breached</div><div className="v">{data.slaBreached}</div></div>
              <div className="fld"><div className="l">Avg pendency</div><div className="v">{data.avgPendencyDays} days</div></div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
