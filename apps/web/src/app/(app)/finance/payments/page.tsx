import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard } from "../../../_components/ds";
import { getPayments } from "../../../_data/loaders";
import { PaymentsTable } from "./PaymentsTable";

export default async function PaymentsPage() {
  const { data: payments, source } = await getPayments();

  const released = payments.filter((p) => p.status === "Released").length;
  const pendingApproval = payments.filter((p) => p.status === "Pending Approval").length;
  const failed = payments.filter((p) => p.status === "Failed").length;

  return (
    <>
      <PageHeader
        title="Payment Gateway"
        subtitle="Track all outward payments — NEFT, RTGS, PFMS, cheque."
        actions={
          <>
            <button className="btn ghost">PFMS Sync</button>
            <button className="btn primary">+ New Payment</button>
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="💳" iconBg="#e7edfd" label="Total Payments" value={payments.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Released" value={released} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending Approval" value={pendingApproval} />
        <StatCard icon="❌" iconBg="#fef3f2" label="Failed" value={failed} />
      </StatGrid>

      <PaymentsTable payments={payments} source={source} />
    </>
  );
}
