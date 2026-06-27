import { PageHeader, StatGrid, StatCard, Card } from "@/app/_components/ds";
import { DelayAnalysisTable, type DelayRow } from "./DelayAnalysisTable";

const rows: DelayRow[] = [
  { project: "NH-44 Bypass Construction", originalDeadline: "2024-03-31", revisedDeadline: "2024-09-30", delayDays: 183, cause: "Land acquisition dispute", rag: "overdue" },
  { project: "District Hospital Upgradation - Lucknow", originalDeadline: "2024-06-30", revisedDeadline: "2024-08-15", delayDays: 46, cause: "Contractor mobilisation delay", rag: "review" },
  { project: "Smart City Phase-II Varanasi", originalDeadline: "2025-03-31", revisedDeadline: "2025-03-31", delayDays: 0, cause: "—", rag: "active" },
  { project: "Integrated Water Supply - Dehradun", originalDeadline: "2024-12-31", revisedDeadline: "2025-06-30", delayDays: 182, cause: "Environmental clearance pending", rag: "overdue" },
  { project: "Solar Power Plant - Jaipur", originalDeadline: "2025-01-15", revisedDeadline: "2025-01-15", delayDays: 0, cause: "—", rag: "active" },
  { project: "State Highway Widening - Bhopal", originalDeadline: "2024-09-30", revisedDeadline: "2024-12-15", delayDays: 76, cause: "Monsoon damage to formation", rag: "review" },
  { project: "Primary School Construction - Raipur", originalDeadline: "2024-08-15", revisedDeadline: "2025-02-28", delayDays: 197, cause: "Fund release delayed by state", rag: "overdue" },
  { project: "Urban Metro Corridor - Patna", originalDeadline: "2026-03-31", revisedDeadline: "2026-03-31", delayDays: 0, cause: "—", rag: "active" },
];

export default function DelayAnalysisPage() {
  const total = rows.length;
  const onTrack = rows.filter((r) => r.rag === "active").length;
  const atRisk = rows.filter((r) => r.rag === "review").length;
  const delayed = rows.filter((r) => r.rag === "overdue").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Delay Analysis" subtitle="RAG dashboard — identify at-risk and delayed projects with root causes." back="/projects" />
      <StatGrid>
        <StatCard icon="📋" iconBg="#eff6ff" label="Total Projects" value={total} />
        <StatCard icon="🟢" iconBg="#ecfdf3" label="On Track" value={onTrack} />
        <StatCard icon="🟡" iconBg="#fffaeb" label="At Risk" value={atRisk} />
        <StatCard icon="🔴" iconBg="#fef3f2" label="Delayed" value={delayed} />
      </StatGrid>
      <Card title="Project Delay Register">
        <DelayAnalysisTable rows={rows} />
      </Card>
    </main>
  );
}
