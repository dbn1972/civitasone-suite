import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { getGrantInstallments } from "../../../_data/loaders";
import { InstallmentsTable } from "./InstallmentsTable";

export default async function GrantInstallmentsPage() {
  const { data: installments, source } = await getGrantInstallments();
  const released = installments.filter((i) => i.status === "released" || i.status === "utilized").length;
  const pending = installments.filter((i) => i.status === "pending").length;
  const totalAmount = installments.reduce((s, i) => s + i.amount, 0);

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/grants">Grants</a>
      </nav>
      <PageHeader title="Grant Installments" subtitle="Disbursement schedule and release status for all grants." />
      {source === "error" && <DataSourceBadge source="error" />}
      <main aria-label="Grant installments">
        <StatGrid>
          <StatCard icon="📋" iconBg="#f1f5f9" label="Total" value={installments.length} />
          <StatCard icon="✅" iconBg="#dcfce7" label="Released" value={released} />
          <StatCard icon="⏳" iconBg="#fef3c7" label="Pending" value={pending} />
          <StatCard icon="💰" iconBg="#dbeafe" label="Total Amount" value={formatMoney(totalAmount)} />
        </StatGrid>
        <Card title="Installments">
          <InstallmentsTable installments={installments} source={source} />
        </Card>
      </main>
    </>
  );
}
