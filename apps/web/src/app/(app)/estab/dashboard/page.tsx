import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getEstabDashboard, getEstabFiles } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, DataTable, EmptyState, RefreshErrorState, Term } from "../../../_components/ds";
import { formatIndianDate, formatDays } from "@/lib/formatters";
import { toHumanError } from "@/lib/messages";

/** Sort rank for a date string: parseable → epoch ms, else -Infinity (sorts last). */
function createdDateRank(d: string | undefined): number {
  if (!d || d === "—") return -Infinity;
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : -Infinity;
}

type RecentFileRow = {
  id: string;
  fileNo: string;
  subject: string;
  status: string;
  due: string;
};

export default async function EstabDashboardPage() {
  const [{ data, source }, { data: files, source: filesSource }] = await Promise.all([
    getEstabDashboard(),
    getEstabFiles(),
  ]);
  const errored = source === "error";
  const filesErrored = filesSource === "error";

  // GAP-ESTAB-DASHBOARD-04: "Recent files" must actually be recent. The list
  // endpoint has no guaranteed order, so sort a copy by createdDate desc before
  // taking the first 8. createdDate can be "—" (apiMappers) / unparseable —
  // those sort last so a dateless row never masquerades as the newest.
  const recent = [...(files ?? [])]
    .sort((a, b) => createdDateRank(b.createdDate) - createdDateRank(a.createdDate))
    .slice(0, 8);
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
        subtitle={<>Integrated <Term name="eOffice" /> — <Term name="DAK" />, noting, multi-hop approval, pendency.</>}
        help="estab"
        actions={
          <>
            <Link href="/estab/dak" className="btn ghost">DAK Registry</Link>
            <Link href="/estab/files/new" className="btn primary">+ Create File</Link>
          </>
        }
      />
      <StatGrid>
        <StatCard icon="📁" tone="info" href="/estab/list" label="Files Pending" value={errored ? "—" : data.filesPending.toLocaleString("en-IN")} />
        <StatCard icon="⏱" tone="bad" href="/estab/inbox" hint="Files past their due date (not archived or disposed), computed in IST." label="SLA Breached" value={errored ? "—" : data.slaBreached.toLocaleString("en-IN")} />
        <StatCard icon="📬" tone="info" href="/estab/dak" label="DAK Pending" value={errored ? "—" : data.dakPending.toLocaleString("en-IN")} />
        <StatCard icon="📊" tone="warn" hint="Average days a pending file has been open." label="Avg Pendency (days)" value={errored ? "—" : formatDays(data.avgPendencyDays)} />
        <StatCard icon="📅" tone="neutral" href="/estab/meetings" label="Meetings Today" value={errored ? "—" : data.meetingsToday.toLocaleString("en-IN")} />
        <StatCard icon="✅" tone="good" href="/estab/compliance" label="Compliance Due" value={errored ? "—" : data.complianceItemsDue.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="grid g-main" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div className="card">
            <div className="card-h">
              <h3>Recent files <Term name="eOffice" before="(" after=")" /></h3>
              <Link className="lnk" href="/estab/list">All files →</Link>
            </div>
            {filesErrored ? (
              <RefreshErrorState error={toHumanError("load", { area: "recent files" })} />
            ) : recentRows.length === 0 ? (
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
              <div className="fld"><div className="l">Files pending</div><div className="v">{errored ? "—" : data.filesPending}</div></div>
              <div className="fld"><div className="l">Unlinked DAK</div><div className="v">{errored ? "—" : data.dakPending}</div></div>
              <div className="fld"><div className="l">SLA breached</div><div className="v">{errored ? "—" : data.slaBreached}</div></div>
              {/* GAP-ESTAB-DASHBOARD-05: this row previously repeated the
                  "Avg pendency" stat tile verbatim. Replaced with the
                  vehiclesInUse figure, which the dashboard already loads but
                  was never displayed anywhere, so the snapshot no longer
                  duplicates a tile and no loaded field is silently dropped. */}
              <div className="fld"><div className="l">Vehicles in use</div><div className="v">{errored ? "—" : data.vehiclesInUse}</div></div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
