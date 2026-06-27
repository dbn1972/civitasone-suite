import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default function CitizenPortalPage() {
  type Row = { metric: string; category: string; currentMonth: string; previousMonth: string; change: string; status: string };

  const rows: Row[] = [
    { metric: "New Registrations", category: "Onboarding", currentMonth: "1,245", previousMonth: "1,102", change: "+13%", status: "On Track" },
    { metric: "Service Requests Filed", category: "Requests", currentMonth: "3,456", previousMonth: "3,210", change: "+7.6%", status: "On Track" },
    { metric: "Grievances Resolved", category: "Grievances", currentMonth: "892", previousMonth: "745", change: "+19.7%", status: "Improved" },
    { metric: "RTI Responses (Within 30 days)", category: "RTI", currentMonth: "98%", previousMonth: "94%", change: "+4%", status: "Excellent" },
    { metric: "Average Resolution Time", category: "SLA", currentMonth: "4.2 days", previousMonth: "5.1 days", change: "-17.6%", status: "Improved" },
    { metric: "Citizen Satisfaction Score", category: "Feedback", currentMonth: "4.1/5", previousMonth: "3.8/5", change: "+7.9%", status: "On Track" },
    { metric: "Mobile App Active Users", category: "Digital", currentMonth: "18,450", previousMonth: "16,200", change: "+13.9%", status: "On Track" },
  ];

  const columns = [
    { key: "metric" as const, label: "Metric" },
    { key: "category" as const, label: "Category" },
    { key: "currentMonth" as const, label: "Current Month" },
    { key: "previousMonth" as const, label: "Previous Month" },
    { key: "change" as const, label: "Change" },
    { key: "status" as const, label: "Status", cellType: "status" as const },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Citizen Portal Overview" subtitle="Key metrics and performance indicators for citizen engagement." back="/citizen" />
      <StatGrid>
        <StatCard icon="👥" iconBg="#eef2ff" label="Registered Citizens" value="1,24,580" />
        <StatCard icon="📋" iconBg="#ecfdf3" label="Active Requests" value="2,341" />
        <StatCard icon="⏱️" iconBg="#fffaeb" label="Avg. Response Time" value="4.2 days" />
        <StatCard icon="😊" iconBg="#fce7ee" label="Satisfaction" value="82%" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Monthly Performance</h3></div>
        <DataTable columns={columns} rows={rows} sortable />
      </div>
    </main>
  );
}
