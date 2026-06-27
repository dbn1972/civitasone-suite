import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { PageHeader, StatGrid, StatCard } from "../../../../_components/ds";
import { getSalarySlips } from "../../../../_data/loaders";
import { formatMoney } from "@/lib/formatters";
import { SalarySlipsTable } from "./SalarySlipsTable";

export default async function SalarySlipsPage() {
  const { data: slips, source } = await getSalarySlips();

  const totalSlips = slips.length;
  const totalGross = slips.reduce((sum, s) => sum + s.gross, 0);
  const totalNet = slips.reduce((sum, s) => sum + s.net, 0);
  const draftCount = slips.filter((s) => s.status === "computed").length;

  return (
    <>
      <PageHeader
        title="Salary Slips"
        subtitle="Individual employee salary statements."
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <StatGrid>
        <StatCard icon="📋" iconBg="#f5f5f5" label="Total Slips" value={totalSlips} />
        <StatCard icon="💰" iconBg="#e6f7f0" label="Total Gross" value={formatMoney(totalGross)} />
        <StatCard icon="✅" iconBg="#e6f0ff" label="Total Net" value={formatMoney(totalNet)} />
        <StatCard icon="📄" iconBg="#fffbe6" label="Pending (Draft)" value={draftCount} />
      </StatGrid>
      <SalarySlipsTable slips={slips} />
    </>
  );
}
