import { PageHeader, StatGrid, StatCard, DataTable, EmptyState } from "@/app/_components/ds";

export default function OutcomeBudgetPage() {
  type Row = { scheme: string; outputIndicator: string; target: string; achieved: string; percentage: string; status: string; [k: string]: unknown };
  const rows: Row[] = [
    { scheme: "PM Gram Sadak Yojana", outputIndicator: "Roads constructed (km)", target: "12,500", achieved: "9,800", percentage: "78%", status: "active" },
    { scheme: "Swachh Bharat Mission", outputIndicator: "Toilets built (units)", target: "50,000", achieved: "48,200", percentage: "96%", status: "approved" },
    { scheme: "Mid-Day Meal Scheme", outputIndicator: "Children covered (lakhs)", target: "85", achieved: "82", percentage: "96%", status: "active" },
    { scheme: "MGNREGA", outputIndicator: "Person-days (Cr)", target: "280", achieved: "195", percentage: "70%", status: "active" },
    { scheme: "PM Awas Yojana", outputIndicator: "Houses completed", target: "25,000", achieved: "18,500", percentage: "74%", status: "active" },
    { scheme: "National Health Mission", outputIndicator: "Health centres upgraded", target: "450", achieved: "312", percentage: "69%", status: "pending" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Outcome Budget" subtitle="Scheme-wise outcome indicators with target vs achievement tracking." back="/finance" />
      <StatGrid>
        <StatCard icon="🎯" iconBg="#e7edfd" label="Schemes Tracked" value={42} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="On Track" value={28} />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Below Target" value={14} />
        <StatCard icon="📊" iconBg="#eff6ff" label="Avg. Achievement" value="79%" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Outcome Indicators</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="🎯" title="No data" message="No outcome budget data available." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "scheme", label: "Scheme" },
              { key: "outputIndicator", label: "Output Indicator" },
              { key: "target", label: "Target", align: "right" },
              { key: "achieved", label: "Achieved", align: "right" },
              { key: "percentage", label: "Achievement %", align: "right" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
          />
        )}
      </div>
    </main>
  );
}
