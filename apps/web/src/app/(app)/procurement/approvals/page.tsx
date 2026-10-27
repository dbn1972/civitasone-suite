import Link from "next/link";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { getTranslations } from "next-intl/server";
import { PageHeader, Card, EmptyState, ErrorState } from "../../../_components/ds";
import { getProcurementApprovals } from "../../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { ProcurementApprovalsPanel } from "./ProcurementApprovalsPanel";
import { ApprovalsRegisterTable, type RegisterRow } from "./ApprovalsRegisterTable";

export default async function ApprovalsPage() {
  const { data: approvals, source } = await getProcurementApprovals();
  const tw = await getTranslations("procurement.w2b.approvals");

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
        subtitle="Pending items requiring policy and budget sign-off, decided in the workflow queue."
        actions={
          <>
            <Link href="/procurement/approvals/escalation" className="btn ghost">Escalation Rules</Link>
            {source === "error" ? <DataSourceBadge source={source} message="Couldn't load — showing nothing" /> : null}
          </>
        }
      />

      {/* D4c #17: the workflow queue is the single source for action and the stat
          tiles (both live in the panel); the register below is a read-only secondary list. */}
      <ProcurementApprovalsPanel viewerRoles={getSessionRoles()} />

      <Card title={tw("registerTitle")}>
        <p style={{ fontSize: "0.8125rem", color: "var(--mut)", margin: "0 0 12px" }}>{tw("registerNote")}</p>
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

    </>
  );
}
