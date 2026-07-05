import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinancePaymentAdvice } from "@/app/_data/loaders";
import { PaymentAdviceTable } from "./PaymentAdviceTable";

export default async function PaymentAdvicePage() {
  const { data: advices, source } = await getFinancePaymentAdvice();
  const issued = advices.filter((a) => String(a.status).toLowerCase() === "issued").length;
  const pending = advices.filter((a) => String(a.status).toLowerCase() === "pending").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Payment Advice"
        subtitle="Payment advice notes issued to banks for disbursement."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="📨" iconBg="#e7edfd" label="Total Advices" value={advices.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Issued" value={issued} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={pending} />
        <StatCard icon="🏦" iconBg="#eff6ff" label="Banks" value={new Set(advices.map((a) => String(a.bank ?? ""))).size} />
      </StatGrid>
      <Card title="Payment Advice Notes">
        <PaymentAdviceTable advices={advices} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
