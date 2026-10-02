import { PageHeader, StatGrid, StatCard } from "../../../_components/ds";
import { getPayments } from "../../../_data/loaders";
import { PaymentsTable } from "./PaymentsTable";
import Link from "next/link";
import { PaymentActions } from "../_components/FinanceActions";
import { getSessionRoles } from "@/lib/auth/roleGuard";
import { PAYMENT_WRITE_ROLES } from "@/lib/auth/workRoles";

export default async function PaymentsPage() {
  const { data: payments, source } = await getPayments();

  const released = payments.filter((p) => p.status === "Released").length;
  const pendingApproval = payments.filter((p) => p.status === "Pending Approval").length;
  const failed = payments.filter((p) => p.status === "Failed").length;
  // GAP-FINANCE-PAYMENTS-04: only offer create / PFMS sync to the roles the API
  // admits; everyone else gets the read-only register (the server stays the authority).
  const canWrite = getSessionRoles().some((r) => (PAYMENT_WRITE_ROLES as readonly string[]).includes(r));

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="Track all outward payments — NEFT, RTGS, PFMS, cheque."
        actions={
          canWrite ? (
            <>
              <PaymentActions />
              <Link href="/finance/payments/new" className="btn primary">+ New Payment</Link>
            </>
          ) : null
        }
      />

      <StatGrid>
        <StatCard icon="💳" iconBg="#e7edfd" label="Total Payments" value={payments.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Released" value={released} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending Approval" value={pendingApproval} />
        <StatCard icon="❌" iconBg="#fef3f2" label="Failed" value={failed} />
      </StatGrid>

      {/* UX-012: the data-source badge now lives inside PaymentsTable, driven
          by the same useSeededResource call that produces its rows — not a
          second, independent read of `source` here that could disagree
          with the table's own cache state (UX-002's pattern). */}
      <PaymentsTable payments={payments} source={source} />
    </>
  );
}
