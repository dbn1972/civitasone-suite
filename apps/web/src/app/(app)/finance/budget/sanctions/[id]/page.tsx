import { PageHeader, Card, EmptyState, LoadErrorState, RecordHeader, DetailList, ApprovalTrail } from "../../../../../_components/ds";
import { getFinanceSanctionById } from "../../../../../_data/loaders";
import { formatIndianDate, formatMoney } from "@/lib/formatters";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { resolveRecordRefs } from "@/lib/records/recordRefs";
import { personLabel } from "@/lib/records/labels";
import { canRaiseForApproval, outcomeLine, raiseBlockedReason, isTerminalStatus } from "@/lib/records/statusActions";
import { SANCTION_STATUS_RULE } from "@/lib/records/status/sanction";
import { SanctionLineItemsTable } from "./SanctionLineItemsTable";
import { SanctionApprovalPanel } from "./SanctionApprovalPanel";
import { SANCTION_APPROVER_ROLES, normalizeSanctionStatus } from "./sanctionApproval";

const STATUS_LABEL: Record<string, string> = { approved: "Approved", pending: "Pending approval", rejected: "Rejected" };

/**
 * Sanction detail (UX-R5 record detail template): one header with the sanction number, a status badge with
 * text, the amount in Indian format and the sanctioning officer by name and designation; label/value details in
 * a DetailList; the approval trail with names; and status-aware actions -- an approved or rejected sanction
 * shows its outcome, never "Raise for approval".
 */
export default async function SanctionDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const result = await getFinanceSanctionById(params.id);
  const { data: sanction, source, status } = result;

  // GAP-FINANCE-BUDGET-SANCTIONS-DETAIL-02: only a real 404 (or a successful empty read) is "not found";
  // anything else is a load error (PermissionDenied for 403, Retry otherwise).
  if (source === "error" && status !== 404) {
    return (
      <>
        <PageHeader title="Sanction Detail" back="/finance/budget/sanctions" backLabel="Sanctions" />
        <LoadErrorState result={result} area="sanction" backHref="/finance/budget/sanctions" backLabel="Sanctions" />
      </>
    );
  }

  if (!sanction) {
    return (
      <>
        <PageHeader title="Sanction Detail" back="/finance/budget/sanctions" backLabel="Sanctions" />
        <EmptyState icon="🖊️" title="Sanction not found" message="This sanction may have been removed or the ID is invalid." />
      </>
    );
  }

  const webStatus = normalizeSanctionStatus(sanction.status);
  const isPending = webStatus === "pending";
  // DETAIL-04: direct approval is an approver-role action server-side
  // (finance_admin/super_admin, plus a distinct-approver 409); only offer it to them.
  const canApprove = getSessionRoles().some((r) => SANCTION_APPROVER_ROLES.includes(r));

  // UX-R5: ONE batched, tenant-scoped lookup for every person this page names.
  const trail = sanction.approvalTrail ?? [];
  const refs = await resolveRecordRefs({ people: [sanction.sanctionedById, ...trail.map((s) => s.actorId)] });
  const makerLabel = personLabel(refs.people, sanction.sanctionedById, sanction.sanctionedBy);
  const decision = [...trail].reverse().find((s) => /^(approved|rejected)$/i.test(s.action));
  const deciderLabel = decision ? personLabel(refs.people, decision.actorId, decision.actor) : null;

  const statusLabel = STATUS_LABEL[webStatus] ?? webStatus;
  const finished = isTerminalStatus(SANCTION_STATUS_RULE, webStatus);
  const outcome = finished ? outcomeLine({ status: webStatus, by: deciderLabel, at: decision?.timestamp ?? null }) : null;
  const raiseAllowed = canRaiseForApproval(SANCTION_STATUS_RULE, webStatus);

  return (
    <>
      <RecordHeader
        kind="Sanction"
        recordNo={sanction.sanctionNo}
        subtitle={sanction.subject}
        status={webStatus}
        statusLabel={statusLabel}
        amountMinor={sanction.amount}
        parties={[{ label: "Sanctioned by", value: makerLabel }]}
        primaryAction={isPending ? <a className="btn primary" href="#sanction-action">Review and decide</a> : undefined}
        outcome={outcome}
        back="/finance/budget/sanctions"
        backLabel="Sanctions"
      />
      <Card title="Sanction details" padding>
        <DetailList
          ariaLabel="Sanction details"
          items={[
            { label: "Sanction no.", value: sanction.sanctionNo, mono: true },
            { label: "Budget head", value: sanction.majorHead },
            { label: "Amount", value: formatMoney(sanction.amount) },
            { label: "Date", value: formatIndianDate(sanction.date) },
            { label: "Sanctioned by", value: makerLabel },
            deciderLabel ? { label: webStatus === "rejected" ? "Rejected by" : "Approved by", value: deciderLabel } : null,
            sanction.remarks ? { label: "Remarks", value: sanction.remarks, wide: true } : null,
          ]}
        />
      </Card>
      <div id="sanction-action">
        <SanctionApprovalPanel
          id={params.id}
          isPending={isPending}
          canApprove={canApprove}
          efileInFlight={sanction.efileInFlight === true}
          {...(sanction.efileFileNo ? { efileFileNo: sanction.efileFileNo } : {})}
          subject={sanction.subject}
          dept={sanction.majorHead ?? "Finance"}
          amountMinor={sanction.amount}
          defaultApprovalChain="file_noting"
          classification="confidential"
          notifyPath={`/api/proxy/v1/finance/sanctions/${params.id}/submit-approval`}
          statusAllowsRaise={raiseAllowed}
          outcome={outcome ?? raiseBlockedReason(SANCTION_STATUS_RULE, webStatus, statusLabel) ?? undefined}
        />
      </div>
      {sanction.lineItems.length > 0 && (
        <Card title="Line items">
          <SanctionLineItemsTable
            rows={sanction.lineItems as ({ description: string; amount: string; head: string } & Record<string, unknown>)[]}
          />
        </Card>
      )}
      <ApprovalTrail
        entries={trail.map((step, i) => ({
          key: `${i}`,
          actor: personLabel(refs.people, step.actorId, step.actor),
          action: step.action,
          at: step.timestamp ?? "",
        }))}
      />
    </>
  );
}
