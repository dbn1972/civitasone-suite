import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { formatMoney } from "@/lib/formatters";
import { getGrantInstallments } from "../../../_data/loaders";
import { InstallmentsTable } from "./InstallmentsTable";
import { ArrowLeft } from "lucide-react";

export default async function GrantInstallmentsPage() {
  const { data: installments, source } = await getGrantInstallments();
  const released = installments.filter((i) => i.status === "released" || i.status === "utilized").length;
  const pending = installments.filter((i) => i.status === "pending").length;
  const totalAmount = installments.reduce((s, i) => s + i.amount, 0);

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        <ArrowLeft aria-hidden="true" size={14} /> <a href="/grants">Grants</a>
      </nav>
      <PageHeader title="Grant Installments" subtitle="Disbursement schedule and release status for all grants." />
      {/* UX-012: the data-source badge now lives inside InstallmentsTable,
          driven by the same useSeededResource call that produces its rows —
          not a second, independent read of `source` here that could
          disagree with the table's own cache state (UX-002's pattern). */}
      <div aria-label="Grant installments">
        <StatGrid>
          <StatCard icon="📋" iconBg="#f1f5f9" label="Total" value={installments.length} />
          <StatCard icon="✅" iconBg="#dcfce7" label="Released" value={released} />
          <StatCard icon="⏳" iconBg="#fef3c7" label="Pending" value={pending} />
          <StatCard icon="💰" iconBg="#dbeafe" label="Total Amount" value={formatMoney(totalAmount)} />
        </StatGrid>
        <Card title="Installments">
          <InstallmentsTable installments={installments} source={source} />
        </Card>
      </div>
    </>
  );
}
