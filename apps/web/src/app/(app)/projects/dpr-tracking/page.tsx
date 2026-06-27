import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { DprTrackingTable, type DprRow } from "./DprTrackingTable";

const rows: DprRow[] = [
  { dprNo: "DPR-2024-001", projectTitle: "NH-44 Bypass Construction", submittedBy: "PWD Jaipur", submittedDate: "2024-01-15", estimatedCost: "₹345 Cr", status: "approved", reviewingAuthority: "MoRTH" },
  { dprNo: "DPR-2024-002", projectTitle: "District Hospital Upgradation - Lucknow", submittedBy: "Health Dept UP", submittedDate: "2024-02-20", estimatedCost: "₹128 Cr", status: "under review", reviewingAuthority: "State PMU" },
  { dprNo: "DPR-2024-003", projectTitle: "Smart City Phase-II Varanasi", submittedBy: "Smart City SPV", submittedDate: "2024-03-05", estimatedCost: "₹512 Cr", status: "approved", reviewingAuthority: "MoHUA" },
  { dprNo: "DPR-2024-004", projectTitle: "Integrated Water Supply - Dehradun", submittedBy: "Jal Nigam UK", submittedDate: "2024-03-18", estimatedCost: "₹89 Cr", status: "rejected", reviewingAuthority: "CPHEEO" },
  { dprNo: "DPR-2024-005", projectTitle: "Solar Power Plant - Jaipur", submittedBy: "RRECL", submittedDate: "2024-04-02", estimatedCost: "₹215 Cr", status: "approved", reviewingAuthority: "MNRE" },
  { dprNo: "DPR-2024-006", projectTitle: "Primary School Construction - Raipur", submittedBy: "Education Dept CG", submittedDate: "2024-04-15", estimatedCost: "₹42 Cr", status: "pending", reviewingAuthority: "State PMU" },
  { dprNo: "DPR-2024-007", projectTitle: "Urban Metro Corridor - Patna", submittedBy: "PMRDA", submittedDate: "2024-05-01", estimatedCost: "₹1,850 Cr", status: "under review", reviewingAuthority: "MoHUA" },
  { dprNo: "DPR-2024-008", projectTitle: "State Highway Widening - Bhopal", submittedBy: "PWD MP", submittedDate: "2024-05-10", estimatedCost: "₹178 Cr", status: "rejected", reviewingAuthority: "NHAI" },
];

export default function DprTrackingPage() {
  const total = rows.length;
  const approved = rows.filter((r) => r.status === "approved").length;
  const underReview = rows.filter((r) => r.status === "under review").length;
  const returned = rows.filter((r) => r.status === "rejected").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="DPR Tracking" subtitle="Detailed Project Report submission, review and approval status." back="/projects" />
      <StatGrid>
        <StatCard icon="📄" iconBg="#eff6ff" label="Total DPRs" value={total} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Approved" value={approved} />
        <StatCard icon="🔍" iconBg="#fffaeb" label="Under Review" value={underReview} />
        <StatCard icon="↩️" iconBg="#fef3f2" label="Returned" value={returned} />
      </StatGrid>
      <Card title="DPR Register">
        <DprTrackingTable rows={rows} />
      </Card>
    </main>
  );
}
