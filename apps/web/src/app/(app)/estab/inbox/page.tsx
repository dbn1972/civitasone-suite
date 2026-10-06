import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getEstabDeskFiles } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, RefreshErrorState } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { daysLeft } from "@/lib/estab/sla";
import { InboxPanel, type InboxRow } from "./InboxPanel";

export default async function EstabInboxPage() {
  const { data: files, source } = await getEstabDeskFiles();
  // A failed fetch must NOT read as "nothing on your desk" (GAP-ESTAB-INBOX-02):
  // show "—" stats and a retryable error state instead of fabricated zeros.
  const errored = source === "error";

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
  // Pending = in-transit / awaiting receipt on the desk (GAP-ESTAB-INBOX-05).
  const awaitingReceipt = files.filter((f) => f.status === "pending").length;
  let overdue = 0;
  let dueSoon = 0;
  for (const f of files) {
    if (f.status === "archived" || f.status === "disposed") continue;
    const d = daysLeft(f.dueDate);
    if (d === null) continue;
    if (d < 0) overdue += 1;
    else if (d <= 3) dueSoon += 1;
  }

  const stat = (n: number) => (errored ? "—" : n.toLocaleString("en-IN"));

  return (
    <>
      {source === "error" && <DataSourceBadge source={source} />}
      <PageHeader
        title="My Desk"
        subtitle="Files pending with you — with SLA and pendency cues so nothing slips."
        back="/estab/list"
        actions={<Link className="btn ghost" href="/estab/list">File register</Link>}
      />
      <StatGrid>
        <StatCard icon="📥" iconBg="#e6f7f5" label="Active on desk" value={stat(active)} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Due ≤ 3 days" value={stat(dueSoon)} />
        <StatCard icon="🔴" iconBg="#fef3f2" label="Overdue" value={stat(overdue)} />
        <StatCard icon="📨" iconBg="#eff6ff" label="Awaiting receipt" value={stat(awaitingReceipt)} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "your desk" })} />
          </div>
        ) : (
          <InboxPanel rows={rows} />
        )}
      </div>
    </>
  );
}
