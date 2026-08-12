import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { EmptyState, PageHeader, StatCard, StatGrid } from "../../../_components/ds";
import { getDocumentInbox, getDocumentStats } from "../_data/loaders";
import type { DakSummary } from "../_data/types";

function priorityPill(p: string) {
  if (p === "urgent") return "bad";
  if (p === "high") return "warn";
  return "approved";
}

function statusPill(s: string) {
  if (s === "acknowledged") return "approved";
  if (s === "forwarded") return "pending";
  if (s === "pending") return "warn";
  return "mut";
}

function formatDate(s: string | null): string {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return s;
  }
}

function DakRow({ dak }: { dak: DakSummary }) {
  return (
    <tr>
      <td style={{ maxWidth: 300 }}>
        <strong>{dak.subject}</strong>
      </td>
      <td>
        <span className={`pill ${priorityPill(dak.priority)}`}>{dak.priority}</span>
      </td>
      <td>
        <span className={`pill ${statusPill(dak.status)}`}>{dak.status}</span>
      </td>
      <td>{formatDate(dak.dueDate)}</td>
      <td>{formatDate(dak.createdAt)}</td>
      <td>
        <button className="btn" style={{ padding: "4px 10px", fontSize: 13 }}>View</button>
      </td>
    </tr>
  );
}

export default async function DocumentInboxPage() {
  const [{ data: items, source }, { data: stats }] = await Promise.all([
    getDocumentInbox(),
    getDocumentStats(),
  ]);

  const urgent = items.filter((d) => d.priority === "urgent").length;
  const pending = items.filter((d) => d.status === "pending").length;
  const forwarded = items.filter((d) => d.status === "forwarded").length;

  return (
    <div className="wrap">
      {source === "error" && <DataSourceBadge source={source} />}

      <PageHeader
        title="e-Office Inbox"
        subtitle="Daks and files assigned to you. Acknowledge, forward, or submit for approval."
        actions={
          <>
            <Link href="/documents/library" className="btn">Document Library</Link>
            <button className="btn primary" style={{ minHeight: 44 }}>+ New Dak</button>
          </>
        }
      />

      <StatGrid>
        <StatCard icon="📥" iconBg="var(--panel)" label="Total in Inbox" value={items.length.toLocaleString("en-IN")} />
        <StatCard icon="⚡" iconBg="var(--panel)" label="Urgent" value={urgent.toLocaleString("en-IN")} />
        <StatCard icon="⏳" iconBg="var(--panel)" label="Pending Action" value={pending.toLocaleString("en-IN")} />
        <StatCard icon="➡️" iconBg="var(--panel)" label="Forwarded" value={forwarded.toLocaleString("en-IN")} />
      </StatGrid>

      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Inbox</h3></div>
        {items.length === 0 ? (
          <EmptyState icon="📥" title="Inbox is empty" message="No daks or files are assigned to you right now." />
        ) : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th scope="col">Subject</th>
                  <th scope="col">Priority</th>
                  <th scope="col">Status</th>
                  <th scope="col">Due</th>
                  <th scope="col">Created</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((d) => <DakRow key={d.id} dak={d} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
