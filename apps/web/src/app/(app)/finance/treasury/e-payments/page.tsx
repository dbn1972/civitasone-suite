import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceEPayments } from "@/app/_data/loaders";
import { EPaymentsTable } from "./EPaymentsTable";

export default async function EPaymentsPage() {
  const { data: orders, source } = await getFinanceEPayments();
  const released = orders.filter((o) => String(o.status).toLowerCase() === "released").length;
  const pending = orders.filter((o) => String(o.status).toLowerCase() === "pending").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="e-Payment Orders"
        subtitle="Electronic payment orders with bank references and status tracking."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="💳" iconBg="#e7edfd" label="Total Orders" value={orders.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Released" value={released} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={pending} />
        {/* PaymentSummary has no "bank" field (referenceId/beneficiary/amountDisplay/status only) — beneficiary is the closest real field. */}
        <StatCard icon="🏦" iconBg="#eff6ff" label="Beneficiaries" value={new Set(orders.map((o) => o.beneficiary)).size} />
      </StatGrid>
      <Card title="Payment Orders">
        <EPaymentsTable orders={orders} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
