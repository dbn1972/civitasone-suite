import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { UtilizationTable, type UtilizationRow } from "./UtilizationTable";

const rows: UtilizationRow[] = [
  { project: "NH-44 Bypass Construction", allocated: "345.00", released: "210.00", utilized: "185.50", utilizationPct: "88%", status: "active" },
  { project: "District Hospital Upgradation - Lucknow", allocated: "128.00", released: "96.00", utilized: "42.30", utilizationPct: "44%", status: "review" },
  { project: "Smart City Phase-II Varanasi", allocated: "512.00", released: "384.00", utilized: "310.20", utilizationPct: "81%", status: "active" },
  { project: "Integrated Water Supply - Dehradun", allocated: "89.00", released: "45.00", utilized: "12.80", utilizationPct: "28%", status: "overdue" },
  { project: "Solar Power Plant - Jaipur", allocated: "215.00", released: "160.00", utilized: "148.90", utilizationPct: "93%", status: "active" },
  { project: "Primary School Construction - Raipur", allocated: "42.00", released: "21.00", utilized: "8.40", utilizationPct: "40%", status: "review" },
  { project: "Urban Metro Corridor - Patna", allocated: "1850.00", released: "925.00", utilized: "780.00", utilizationPct: "84%", status: "active" },
  { project: "State Highway Widening - Bhopal", allocated: "178.00", released: "134.00", utilized: "98.60", utilizationPct: "74%", status: "active" },
];

export default function UtilizationPage() {
  const totalAllocated = "₹3,359 Cr";
  const totalUtilized = "₹1,586.70 Cr";
  const avgUtilization = "66%";
  const unspent = "₹1,772.30 Cr";

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Fund Utilization" subtitle="Track allocation, releases and utilization across all projects." back="/projects" />
      <StatGrid>
        <StatCard icon="💰" iconBg="#eff6ff" label="Total Allocated" value={totalAllocated} />
        <StatCard icon="📊" iconBg="#ecfdf3" label="Utilized" value={totalUtilized} />
        <StatCard icon="📈" iconBg="#fffaeb" label="Utilization %" value={avgUtilization} />
        <StatCard icon="🏦" iconBg="#f1f5f9" label="Unspent Balance" value={unspent} />
      </StatGrid>
      <Card title="Project-wise Utilization">
        <UtilizationTable rows={rows} />
      </Card>
    </main>
  );
}
