import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getEstabFiles } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { InboxPanel, type InboxRow } from "./InboxPanel";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function daysLeft(dueDate?: string): number | null {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return null;
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return Math.ceil((due.getTime() - startOfToday.getTime()) / MS_PER_DAY);
}

export default async function EstabInboxPage() {
  const { data: files, source } = await getEstabFiles();

  const rows: InboxRow[] = files.map((f) => ({
    id: f.id,
    fileNo: f.fileNo,
    subject: f.subject,
    status: f.status.replace(/_/g, " "),
    statusRaw: f.status,
    currentHolder: f.currentHolder,
    dueDate: f.dueDate,
  }));

  const active = files.filter((f) => f.status === "active").length;
  let overdue = 0;
  let dueSoon = 0;
  for (const f of files) {
    if (f.status === "archived" || f.status === "disposed") continue;
    const d = daysLeft(f.dueDate);
    if (d === null) continue;
    if (d < 0) overdue += 1;
    else if (d <= 3) dueSoon += 1;
  }

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="My Desk"
        subtitle="Files pending with you — with SLA and pendency cues so nothing slips."
        back="/estab/list"
        actions={<a className="btn ghost" href="/estab/list">File register</a>}
      />
      <StatGrid>
        <StatCard icon="📥" iconBg="#e6f7f5" label="Active on desk" value={active.toLocaleString("en-IN")} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Due ≤ 3 days" value={dueSoon.toLocaleString("en-IN")} />
        <StatCard icon="🔴" iconBg="#fef3f2" label="Overdue" value={overdue.toLocaleString("en-IN")} />
        <StatCard icon="🗂️" iconBg="#eff6ff" label="Total files" value={files.length.toLocaleString("en-IN")} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <InboxPanel rows={rows} />
      </div>
    </>
  );
}
