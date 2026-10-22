import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getEstabDeskFiles } from "../../../_data/loaders";
import { PageHeader, StatCard, StatGrid, RefreshErrorState, EmptyState } from "../../../_components/ds";
import { toHumanError } from "@/lib/messages";
import { daysLeft, isClosedStatus, isOverdue } from "@/lib/estab/sla";
import { getTranslations } from "next-intl/server";
import { InboxPanel, type InboxRow } from "./InboxPanel";

export default async function EstabInboxPage() {
  const t = await getTranslations("estabW2");
  const { data: desk, source } = await getEstabDeskFiles();
  const files = desk.files;
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
    if (isClosedStatus(f.status)) continue;
    // One overdue definition for the whole module (lib/estab/sla.ts); the dashboard counts the same rule office-wide.
    if (isOverdue(f)) { overdue += 1; continue; }
    const d = daysLeft(f.dueDate);
    if (d !== null && d <= 3) dueSoon += 1;
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
        <StatCard icon="📥" tone="good" label="Active on desk" value={stat(active)} />
        <StatCard icon="⏳" tone="warn" label="Due ≤ 3 days" value={stat(dueSoon)} />
        <StatCard icon="🔴" tone="bad" label={t("inboxOverdue")} hint={t("inboxOverdueHint")} value={stat(overdue)} />
        <StatCard icon="📨" tone="info" label="Awaiting receipt" value={stat(awaitingReceipt)} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        {errored ? (
          <div className="pad">
            <RefreshErrorState error={toHumanError("load", { area: "your desk" })} />
          </div>
        ) : desk.notEnrolled && files.length === 0 ? (
          // Not an enrolled eOffice operator, so no file can be forwarded to this officer: say so, rather
          // than the generic "nothing on your desk", which reads as a quiet day.
          <EmptyState icon="🪪" title={t("inboxNotOperatorTitle")} message={t("inboxNotOperatorMessage")} />
        ) : (
          <InboxPanel rows={rows} />
        )}
      </div>
    </>
  );
}
