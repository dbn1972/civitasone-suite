import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "../../../../_components/ds";
import { getFinanceBills } from "../../../../_data/loaders";
import { formatMoney } from "@/lib/formatters";
import { BillCreateAction } from "../../_components/FinanceActions";
import { BillsTable } from "./BillsTable";
import Link from "next/link";

export default async function BillsPage() {
  const { data: bills, source } = await getFinanceBills();

  const inProcess = bills.filter((b) => b.status === "pending" || b.status === "under_review").length;
  const paid = bills.filter((b) => b.status === "paid").length;
  const totalAmount = bills.reduce((s, b) => s + b.amount, 0);
  const paidAmount = bills.filter((b) => b.status === "paid").reduce((s, b) => s + b.amount, 0);

  return (
    <>
      <PageHeader
        title="Bill Processing"
        subtitle="Receive, pre-audit, pass and pay bills against sanctions."
        actions={
          <>
            <Link href="/finance/config" className="btn ghost">Pre-audit rules</Link>
            <BillCreateAction />
            {source === "error" ? <DataSourceBadge source={source} /> : null}
          </>
        }
      />

      <StatGrid>
        <StatCard icon="🧮" iconBg="#e7edfd" label="Bills In Process" value={inProcess} />
        <StatCard icon="⏱" iconBg="#fffaeb" label="Total Bills" value={bills.length} />
        <StatCard icon="💸" iconBg="#eff6ff" label="Value In Pipeline" value={formatMoney(totalAmount)} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Paid (MTD)" value={formatMoney(paidAmount)} />
      </StatGrid>

      <Card title="Bill processing">
        <BillsTable bills={bills} source={source} />
      </Card>
    </>
  );
}
