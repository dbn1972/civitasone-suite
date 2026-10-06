import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, Card, StatCard, StatGrid, StatusPill, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { getGrantDisbursementById } from "@/app/_data/loaders";
import { RaiseEOfficeNote } from "@/app/_components/RaiseEOfficeNote";
import { getSessionRoles, hasAnyRole } from "@/lib/auth/roleGuard";
import { GRANTS_DISBURSE_ROLES } from "../../roles";
import { toHumanError } from "@/lib/messages";
import { formatMoney, formatIndianDate } from "@/lib/formatters";

export default async function GrantDisbursementDetailPage({ params }: { params: { id: string } }) {
  const { data: disbursement, source, status } = await getGrantDisbursementById(params.id);

  // GAP-GRANTS-DISBURSEMENTS-DETAIL-04: a failed fetch must not read as
  // "Disbursement not found … ID is invalid". Show a retry state for an error;
  // keep EmptyState only for a genuine not-found (successful api with no match).
  if (!disbursement && source === "error" && status !== 404) {
    return (
      <>
        <PageHeader title="Disbursement Detail" back="/grants/releases" />
        <RefreshErrorState
          error={toHumanError("load", { area: "disbursement" })}
          backHref="/grants/releases"
          source={{ status, area: "disbursement" }}
        />
      </>
    );
  }

  if (!disbursement) {
    return (
      <>
        <PageHeader title="Disbursement Detail" back="/grants/releases" />
        <EmptyState icon="💰" title="Disbursement not found" message="This disbursement may have been removed or the ID is invalid." />
      </>
    );
  }

  // GAP-GRANTS-DISBURSEMENTS-DETAIL-02/08 (money unit): GrantRelease.amount is
  // MINOR units (paise) end to end now (grant-service passes amount_minor
  // through unchanged). Forward it straight to the eOffice note as paise — no
  // rupees→paise conversion, no float *100 — and display it with formatMoney.
  const amountMinor = Number.isFinite(disbursement.amount) ? Math.round(disbursement.amount) : 0;
  const roles = getSessionRoles();
  const canRaise = hasAnyRole(roles, GRANTS_DISBURSE_ROLES);

  return (
    <>
      <PageHeader
        title={`Disbursement ${disbursement.releaseNo}`}
        subtitle={disbursement.granteeName ?? undefined}
        back="/grants/releases"
        actions={
          <>
            <StatusPill status={disbursement.status} />
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      {/* GAP-GRANTS-DISBURSEMENTS-DETAIL-08: the stat cards are the single
          summary; the duplicate details Card (which repeated Amount/Grantee/
          Release Date/Status) is removed. The details Card now only carries
          fields NOT already in the stat row. */}
      <StatGrid>
        <StatCard icon="₹" iconBg="#ecfdf5" label="Amount" value={formatMoney(disbursement.amount)} />
        <StatCard icon="📋" iconBg="#eff6ff" label="Status" value={disbursement.status.replace(/_/g, " ")} />
        <StatCard icon="👥" iconBg="#faf5ff" label="Grantee" value={disbursement.granteeName ?? "—"} />
        <StatCard icon="📅" iconBg="#fff7ed" label="Release Date" value={formatIndianDate(disbursement.releaseDate)} />
      </StatGrid>

      <Card title="Disbursement details" padding>
        <div className="fields">
          <div className="field"><span className="label">Release No</span><span className="mono">{disbursement.releaseNo}</span></div>
          <div className="field"><span className="label">Grant No</span><span>{disbursement.grantNo}</span></div>
          {disbursement.bankRef && (
            <div className="field"><span className="label">Bank Ref</span><span className="mono">{disbursement.bankRef}</span></div>
          )}
        </div>
      </Card>

      {/* GAP-GRANTS-DISBURSEMENTS-DETAIL-01: raising the approval note is a
          maker action — only shown to a grants disburse role. The eOffice
          from-module route + grant-service submit-approval both enforce roles
          (and separation of duties) server-side; this is UX + defence in depth. */}
      {canRaise ? (
        <RaiseEOfficeNote
          refType="grant_disbursement"
          refId={params.id}
          subject={`Disbursement ${params.id}`}
          dept="Grants"
          amountMinor={amountMinor}
          defaultApprovalChain="file_noting"
          notifyPath={`/api/proxy/v1/grants/disbursements/${params.id}/submit-approval`}
        />
      ) : null}
    </>
  );
}
