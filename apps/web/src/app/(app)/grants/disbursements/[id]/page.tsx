import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, Card, StatCard, StatGrid, StatusPill, EmptyState } from "@/app/_components/ds";
import { getGrantDisbursementById } from "@/app/_data/loaders";
import { RaiseEOfficeNote } from "@/app/_components/RaiseEOfficeNote";
import { formatMoney, formatIndianDate } from "@/lib/formatters";

export default async function GrantDisbursementDetailPage({ params }: { params: { id: string } }) {
  const { data: disbursement, source } = await getGrantDisbursementById(params.id);

  if (!disbursement) {
    return (
      <>
        {/* UX: PageHeader's `back` prop already renders the single breadcrumb
            below — this branch used to ALSO render its own manual
            <nav aria-label="Breadcrumb"> here, doubling it. Removed; do not
            re-add a second breadcrumb alongside the `back` prop. */}
        <PageHeader title="Disbursement Detail" back="/grants/releases" />
        <EmptyState icon="💰" title="Disbursement not found" message="This disbursement may have been removed or the ID is invalid." />
      </>
    );
  }

  // GrantRelease.amount is in rupees; RaiseEOfficeNote + formatMoney expect minor units (paise).
  const amountMinor = Math.round(disbursement.amount * 100);

  return (
    <>
      {/* UX: PageHeader's `back` prop already renders the single breadcrumb
          below — this page used to ALSO render its own manual
          <nav aria-label="Breadcrumb"> here, doubling it. Removed; do not
          re-add a second breadcrumb alongside the `back` prop. */}
      <PageHeader
        title={`Disbursement ${disbursement.releaseNo}`}
        subtitle={disbursement.granteeName !== "—" ? disbursement.granteeName : undefined}
        back="/grants/releases"
        actions={
          <>
            <StatusPill status={disbursement.status} />
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="₹" iconBg="#ecfdf5" label="Amount" value={formatMoney(amountMinor)} />
        <StatCard icon="📋" iconBg="#eff6ff" label="Status" value={disbursement.status.replace(/_/g, " ")} />
        <StatCard icon="👥" iconBg="#faf5ff" label="Grantee" value={disbursement.granteeName} />
        <StatCard icon="📅" iconBg="#fff7ed" label="Release Date" value={formatIndianDate(disbursement.releaseDate)} />
      </StatGrid>

      <Card title="Disbursement details" padding>
        <div className="fields">
          <div className="field"><span className="label">Release No</span><span className="mono">{disbursement.releaseNo}</span></div>
          <div className="field"><span className="label">Grant No</span><span>{disbursement.grantNo}</span></div>
          <div className="field"><span className="label">Grantee</span><span>{disbursement.granteeName}</span></div>
          <div className="field"><span className="label">Amount</span><span>{formatMoney(amountMinor)}</span></div>
          <div className="field"><span className="label">Release Date</span><span>{formatIndianDate(disbursement.releaseDate)}</span></div>
          <div className="field"><span className="label">Status</span><StatusPill status={disbursement.status} /></div>
          {disbursement.bankRef && (
            <div className="field"><span className="label">Bank Ref</span><span className="mono">{disbursement.bankRef}</span></div>
          )}
        </div>
      </Card>

      <RaiseEOfficeNote
        refType="grant_disbursement"
        refId={params.id}
        subject={`Disbursement ${params.id}`}
        dept="Grants"
        amountMinor={amountMinor}
        defaultApprovalChain="file_noting"
        notifyPath={`/api/proxy/v1/grants/disbursements/${params.id}/submit-approval`}
      />
    </>
  );
}
