import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default function SurveysPage() {
  type Row = { surveyName: string; responses: number; completion: string; period: string; status: string };

  const rows: Row[] = [
    { surveyName: "Public Transport Satisfaction Survey 2025", responses: 4521, completion: "78%", period: "Jan 2025 – Feb 2025", status: "Active" },
    { surveyName: "Solid Waste Management Feedback", responses: 2890, completion: "92%", period: "Dec 2024 – Jan 2025", status: "Completed" },
    { surveyName: "Smart City Services Rating", responses: 6234, completion: "85%", period: "Nov 2024 – Dec 2024", status: "Completed" },
    { surveyName: "Drinking Water Quality Assessment", responses: 1345, completion: "45%", period: "Feb 2025 – Mar 2025", status: "Active" },
    { surveyName: "Street Lighting Adequacy Survey", responses: 890, completion: "34%", period: "Feb 2025 – Apr 2025", status: "Active" },
    { surveyName: "E-Governance Service Usability", responses: 3120, completion: "88%", period: "Oct 2024 – Nov 2024", status: "Completed" },
    { surveyName: "Budget Priorities – Citizens' Input", responses: 8902, completion: "95%", period: "Sep 2024 – Oct 2024", status: "Closed" },
  ];

  const columns = [
    { key: "surveyName" as const, label: "Survey Name" },
    { key: "responses" as const, label: "Responses", align: "right" as const },
    { key: "completion" as const, label: "Completion %" },
    { key: "period" as const, label: "Period" },
    { key: "status" as const, label: "Status", cellType: "status" as const },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Citizen Surveys" subtitle="Public opinion surveys and feedback collection programmes." back="/citizen" />
      <StatGrid>
        <StatCard icon="📊" iconBg="#eef2ff" label="Active Surveys" value={3} />
        <StatCard icon="📝" iconBg="#ecfdf3" label="Total Responses" value="27,902" />
        <StatCard icon="✅" iconBg="#fffaeb" label="Avg. Completion" value="74%" />
        <StatCard icon="📅" iconBg="#fce7ee" label="Completed This Quarter" value={3} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Survey Register</h3></div>
        <DataTable columns={columns} rows={rows} sortable filterable />
      </div>
    </main>
  );
}
