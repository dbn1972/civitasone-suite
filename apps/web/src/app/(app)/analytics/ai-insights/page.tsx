import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default function AiInsightsPage() {
  type Row = { insightTitle: string; module: string; confidence: string; generatedDate: string; actionRecommended: string; status: string };

  const rows: Row[] = [
    { insightTitle: "Budget under-utilisation predicted for Q4 – PWD", module: "Finance", confidence: "92%", generatedDate: "2025-02-10", actionRecommended: "Expedite pending sanctions", status: "New" },
    { insightTitle: "Vendor concentration risk – IT hardware", module: "Procurement", confidence: "87%", generatedDate: "2025-02-09", actionRecommended: "Diversify vendor base", status: "Reviewed" },
    { insightTitle: "Leave pattern anomaly – Dept of Education", module: "HR", confidence: "78%", generatedDate: "2025-02-08", actionRecommended: "Review attendance data", status: "In Progress" },
    { insightTitle: "Revenue surge expected – Property tax zone 4", module: "Revenue", confidence: "85%", generatedDate: "2025-02-07", actionRecommended: "Prepare collection capacity", status: "Actioned" },
    { insightTitle: "Citizen grievance spike predicted – Ward 12", module: "Citizen Services", confidence: "81%", generatedDate: "2025-02-06", actionRecommended: "Pre-deploy mobile team", status: "New" },
    { insightTitle: "Project delay risk – NH widening Phase 2", module: "Projects", confidence: "94%", generatedDate: "2025-02-05", actionRecommended: "Escalate to PMU", status: "Reviewed" },
    { insightTitle: "Duplicate payment pattern detected", module: "Finance", confidence: "96%", generatedDate: "2025-02-04", actionRecommended: "Trigger internal audit", status: "Actioned" },
  ];

  const columns = [
    { key: "insightTitle" as const, label: "Insight" },
    { key: "module" as const, label: "Module" },
    { key: "confidence" as const, label: "Confidence" },
    { key: "generatedDate" as const, label: "Generated" },
    { key: "actionRecommended" as const, label: "Recommended Action" },
    { key: "status" as const, label: "Status", cellType: "status" as const },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="AI Insights" subtitle="Machine learning generated insights and recommended actions across modules." back="/analytics" />
      <StatGrid>
        <StatCard icon="🤖" iconBg="#eef2ff" label="Total Insights" value={7} />
        <StatCard icon="🆕" iconBg="#ecfdf3" label="New (Unread)" value={2} />
        <StatCard icon="✅" iconBg="#fffaeb" label="Actioned" value={2} />
        <StatCard icon="🎯" iconBg="#fce7ee" label="Avg. Confidence" value="88%" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>AI-Generated Insights</h3></div>
        <DataTable columns={columns} rows={rows} sortable filterable />
      </div>
    </main>
  );
}
