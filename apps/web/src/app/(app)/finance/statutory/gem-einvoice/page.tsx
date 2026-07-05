import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceGemEInvoice } from "@/app/_data/loaders";
import { GemEInvoiceTable } from "./GemEInvoiceTable";

export default async function GemEInvoicePage() {
  const { data: invoices, source } = await getFinanceGemEInvoice();
  const validated = invoices.filter((i) => String(i.status).toLowerCase() === "validated").length;
  const pending = invoices.filter((i) => String(i.status).toLowerCase() === "pending").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="GeM & e-Invoice"
        subtitle="GeM orders and IRN-validated e-invoices."
        back="/finance"
        actions={source === "error" ? <DataSourceBadge source={source} /> : null}
      />
      <StatGrid>
        <StatCard icon="🛒" iconBg="#e7edfd" label="Total Invoices" value={invoices.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Validated" value={validated} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={pending} />
        <StatCard icon="📋" iconBg="#eff6ff" label="GeM Orders" value={invoices.filter((i) => String(i.source) === "GeM").length} />
      </StatGrid>
      <Card title="e-Invoice Register">
        <GemEInvoiceTable invoices={invoices} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
