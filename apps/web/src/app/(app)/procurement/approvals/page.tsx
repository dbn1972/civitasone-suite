import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card, EmptyState, ErrorState } from "../../../_components/ds";
import { getProcurementApprovals } from "../../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { ProcurementApprovalsPanel } from "./ProcurementApprovalsPanel";
import { ApprovalsRegisterTable, type RegisterRow } from "./ApprovalsRegisterTable";

/**
 * GAP-PROCUREMENT-APPROVALS-04: an approval is overdue/due-today when its ISO
 * `dueAt` is on or before the end of today. Comparing dates — not
 * substring-matching the localised `dueDisplay` string — survives
 * localisation and wording changes. Approvals with no `dueAt` are not counted
 * (we can't assert they're overdue).
 */
function countDueTodayOrOverdue(approvals: { dueAt?: string }[]): number {
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);
  let n = 0;
  for (const a of approvals) {
    if (!a.dueAt) continue;
    const due = new Date(a.dueAt);
    if (!Number.isNaN(due.getTime()) && due.getTime() <= endOfToday.getTime()) n += 1;
  }
  return n;
}

export default async function ApprovalsPage() {
  const { data: approvals, source } = await getProcurementApprovals();
  // GAP-PROCUREMENT-APPROVALS-03: on a failed load `approvals` is [], so the
  // stat cards must show "—" rather than a misleading real "0" under an
  // ErrorState. Same convention as the procurement dashboard.
  const errored = source === "error";

  const dueSoon = countDueTodayOrOverdue(approvals);

  const rows: RegisterRow[] = approvals.map((a) => ({
    // GAP-PROCUREMENT-APPROVALS-04: drop the raw internal UUID column — it is
    // not actionable to a clerk. The human-readable Reference stays.
    referenceId: a.referenceId,
    owner: a.owner,
    dueDisplay: a.dueDisplay,
    // GAP-PROCUREMENT-APPROVALS-04: the reference links to its document.
    href: a.refType === "procurement_indent" ? `/procurement/indents/${a.id}`
      : a.refType === "procurement_po" ? `/procurement/orders/${a.id}`
        : null,
  }));

  return (
    <>
      <PageHeader
        title="Procurement Approvals"
        subtitle="Pending items requiring policy and budget sign-off."
        actions={
          <>
            <Link href="/procurement/approvals/escalation" className="btn ghost">Escalation Rules</Link>
            {source === "error" ? <DataSourceBadge source={source} message="Couldn't load — showing nothing" /> : null}
          </>
        }
      />

      {/* GAP-PROCUREMENT-APPROVALS-02: two sources feed this page and they are not
          reconciled (no single source of truth has been chosen -- product
          decision). Say so, so an approver never reads the register total as
          the size of the actionable queue below. */}
      <p style={{ fontSize: "0.8125rem", color: "var(--mut)", margin: "0 0 12px" }}>
        The figures and table below come from the procurement approvals register. The workflow queue underneath lists
        the tasks you can act on; the two are separate sources and their counts can differ.
      </p>

      <StatGrid>
        {/* GAP-PROCUREMENT-APPROVALS-02: the "Action Required" card used to
            duplicate "Pending Approvals" verbatim. It is replaced below with
            two genuinely distinct metrics ("Unique Owners" and "With a due
            date"), so no two cards report the same number. */}
        <StatCard icon="⏳" tone="info" label="Pending Approvals" value={errored ? "—" : approvals.length} />
        <StatCard icon="⚠️" tone="bad" label="Due today or overdue" value={errored ? "—" : dueSoon} />
        <StatCard icon="👥" tone="info" label="Unique Owners" value={errored ? "—" : new Set(approvals.map((a) => a.owner)).size} />
        <StatCard icon="📋" tone="good" label="With a due date" value={errored ? "—" : approvals.filter((a) => a.dueAt).length} />
      </StatGrid>

      <Card title="Pending approvals (register)">
        {source === "error" ? (
          // L4 fix: see tenders/page.tsx for the same fix and rationale. Note
          // this page ALSO renders <ProcurementApprovalsPanel/> below, which
          // is a second, independent data source with its own error handling
          // (fixed separately) — this ErrorState covers only the table above.
          <ErrorState error={toHumanError("load", { area: "approvals" })} backHref="/procurement/approvals" />
        ) : rows.length === 0 ? (
          <EmptyState icon="✅" title="No pending approvals" message="All items are up to date." />
        ) : (
          <ApprovalsRegisterTable rows={rows} />
        )}
      </Card>

      <ProcurementApprovalsPanel viewerRoles={getSessionRoles()} />
    </>
  );
}
