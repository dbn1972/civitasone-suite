import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getSAInvoices } from "@/app/_data/loaders";
import { InvoicesTable } from "./InvoicesTable";

export default async function InvoicesPage() {
  const { data: invoices, source } = await getSAInvoices();
  const paid = invoices.filter((i) => String(i.status).toLowerCase() === "paid").length;
  const overdue = invoices.filter((i) => String(i.status).toLowerCase() === "overdue").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Invoices" subtitle="Platform billing invoices for all tenants." back="/admin" actions={source === "error" ? <DataSourceBadge source={source} /> : null} />
      <StatGrid>
        <StatCard icon="🧾" iconBg="#eef2ff" label="Total Invoices" value={invoices.length} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Paid" value={paid} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={invoices.length - paid - overdue} />
        <StatCard icon="⚠️" iconBg="#fce7ee" label="Overdue" value={overdue} />
      </StatGrid>
      <Card title="Invoice Register">
        <InvoicesTable invoices={invoices} source={source === "error" ? "error" : "api"} />
      </Card>
    </main>
  );
}
