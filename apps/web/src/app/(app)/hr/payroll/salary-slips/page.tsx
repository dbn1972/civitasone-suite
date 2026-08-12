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
  const draftCount = slips.filter((s) => s.status === "draft").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Salary Slips"
        subtitle="Individual employee salary statements."
        back="/hr/payroll"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="📋" iconBg="var(--panel)" label="Total Slips" value={totalSlips} />
        <StatCard icon="💰" iconBg="var(--goodbg)" label="Total Gross" value={formatMoney(totalGross)} />
        <StatCard icon="✅" iconBg="var(--infobg)" label="Total Net" value={formatMoney(totalNet)} />
        <StatCard icon="📄" iconBg="var(--warnbg)" label="Pending (Draft)" value={draftCount} />
      </StatGrid>
      <SalarySlipsTable slips={slips} />
    </main>
  );
}
