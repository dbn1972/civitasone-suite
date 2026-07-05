import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { getFinanceReceipts } from "@/app/_data/loaders";
import { ReceiptsTable } from "./ReceiptsTable";

export default async function ReceiptsPage() {
  const { data: receipts, source } = await getFinanceReceipts();
  const neft = receipts.filter((r) => String(r.mode).toLowerCase() === "neft").length;
  const rtgs = receipts.filter((r) => String(r.mode).toLowerCase() === "rtgs").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Receipt Vouchers" subtitle="Revenue receipts with payer details, budget head mapping, and payment mode." back="/finance" actions={source === "error" ? <DataSourceBadge source={source} /> : null} />
      <StatGrid>
        <StatCard icon="📥" iconBg="#ecfdf3" label="Total Receipts" value={receipts.length} />
        <StatCard icon="⚡" iconBg="#e7edfd" label="NEFT" value={neft} />
        <StatCard icon="🏦" iconBg="#eff6ff" label="RTGS" value={rtgs} />
        <StatCard icon="💵" iconBg="#fffaeb" label="Other" value={receipts.length - neft - rtgs} />
      </StatGrid>
      <Card title="Receipt Vouchers"><ReceiptsTable receipts={receipts} source={source === "error" ? "error" : "api"} /></Card>
    </main>
  );
}
