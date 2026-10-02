import { PageHeader, Card, StatCard, StatGrid, StatusPill, EmptyState, LoadErrorState } from "../../../../../_components/ds";
import { getFinanceSanctionById } from "../../../../../_data/loaders";
import { formatIndianDate, formatIndianDateTime, formatMoney } from "@/lib/formatters";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { SanctionLineItemsTable } from "./SanctionLineItemsTable";
import { SanctionApprovalPanel } from "./SanctionApprovalPanel";
import { SANCTION_APPROVER_ROLES, normalizeSanctionStatus } from "./sanctionApproval";

/** GAP-FINANCE-BUDGET-SANCTIONS-DETAIL-06: an unparseable timestamp reads "—", never raw text. */
function formatTrailTimestamp(ts: string | null | undefined): string {
  if (!ts || Number.isNaN(new Date(ts).getTime())) return "—";
  return formatIndianDateTime(ts);
}

export default async function SanctionDetailPage({ params }: { params: { id: string } }) {
  const result = await getFinanceSanctionById(params.id);
  const { data: sanction, source, status } = result;

  // GAP-FINANCE-BUDGET-SANCTIONS-DETAIL-02: a 500/403/timeout used to be
  // presented as "Sanction not found ... the ID is invalid". Only a real 404
  // (or a successful empty read) is "not found"; anything else is a load
  // error (PermissionDenied for 403, Retry otherwise).
  if (source === "error" && status !== 404) {
    return (
      <>
        <PageHeader title="Sanction Detail" back="/finance/budget/sanctions" />
        <LoadErrorState result={result} area="sanction" backHref="/finance/budget/sanctions" backLabel="Sanctions" />
      </>
    );
  }

  if (!sanction) {
    return (
      <>
        <nav aria-label="Breadcrumb" className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
          <a href="/finance/budget/sanctions">Sanctions</a> <span aria-hidden="true">›</span> Not found
        </nav>
        <PageHeader title="Sanction Detail" back="/finance/budget/sanctions" />
        <EmptyState icon="🖊️" title="Sanction not found" message="This sanction may have been removed or the ID is invalid." />
      </>
    );
  }

  const isPending = normalizeSanctionStatus(sanction.status) === "pending";
  // DETAIL-04: direct approval is an approver-role action server-side
  // (finance_admin/super_admin, plus a distinct-approver 409); only offer it to them.
  const canApprove = getSessionRoles().some((r) => SANCTION_APPROVER_ROLES.includes(r));

  return (
    <>
      <nav aria-label="Breadcrumb" className="crumbs" style={{ fontSize: 13, color: "var(--ink2)", marginBottom: 8 }}>
        <a href="/finance">Finance</a> <span aria-hidden="true">›</span>{" "}
        <a href="/finance/budget/sanctions">Sanctions</a> <span aria-hidden="true">›</span>{" "}
        <span aria-current="page">{sanction.sanctionNo}</span>
      </nav>

      <PageHeader
        title={sanction.sanctionNo}
        subtitle={sanction.subject}
        back="/finance/budget/sanctions"
        actions={
          <StatusPill status={sanction.status} />
        }
      />

      <StatGrid>
        <StatCard icon="₹" iconBg="#ecfdf5" label="Amount" value={formatMoney(sanction.amount)} />
        <StatCard icon="📋" iconBg="#eff6ff" label="Status" value={sanction.status.replace(/_/g, " ")} />
        <StatCard icon="👤" iconBg="#faf5ff" label="Sanctioned By" value={sanction.sanctionedBy} />
        <StatCard icon="📅" iconBg="#fff7ed" label="Date" value={formatIndianDate(sanction.date)} />
      </StatGrid>

      <Card title="Sanction details" padding>
        <div className="fields">
          <div className="field"><span className="label">Sanction No</span><span className="mono">{sanction.sanctionNo}</span></div>
          <div className="field"><span className="label">Major Head</span><span>{sanction.majorHead}</span></div>
          <div className="field"><span className="label">Amount</span><span>{formatMoney(sanction.amount)}</span></div>
          <div className="field"><span className="label">Sanctioned By</span><span>{sanction.sanctionedBy}</span></div>
          <div className="field"><span className="label">Date</span><span>{formatIndianDate(sanction.date)}</span></div>
          <div className="field"><span className="label">Status</span><StatusPill status={sanction.status} /></div>
          {sanction.remarks && (
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <span className="label">Remarks</span>
              <span>{sanction.remarks}</span>
            </div>
          )}
        </div>
      </Card>

      <SanctionApprovalPanel
        id={params.id}
        isPending={isPending}
        canApprove={canApprove}
        subject={sanction.subject}
        dept={sanction.majorHead ?? "Finance"}
        amountMinor={sanction.amount}
        defaultApprovalChain="file_noting"
        classification="confidential"
        notifyPath={`/api/proxy/v1/finance/sanctions/${params.id}/submit-approval`}
      />

      {sanction.lineItems.length > 0 && (
        <Card title="Line items">
          <SanctionLineItemsTable
            rows={sanction.lineItems as ({ description: string; amount: string; head: string } & Record<string, unknown>)[]}
          />
        </Card>
      )}

      {sanction.approvalTrail.length > 0 && (
        <Card title="Approval trail" padding>
          <ol className="tl">
            {sanction.approvalTrail.map((step: { actor: string; action: string; timestamp: string }, i: number) => (
              <li key={i}>
                <div className="tl-dot" />
                <div className="tl-body">
                  <div className="tl-title">{step.actor} — {step.action}</div>
                  <div className="tl-sub">{formatTrailTimestamp(step.timestamp)}</div>
                </div>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </>
  );
}
