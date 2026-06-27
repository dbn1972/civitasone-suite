import { PageHeader, StatGrid, StatCard, DataTable, EmptyState } from "@/app/_components/ds";

export default function SchemeTrackingPage() {
  type Row = { id: string; scheme: string; sanctioned: string; released: string; spent: string; spentPercent: string; status: string; [k: string]: unknown };
  const rows: Row[] = [
    { id: "sch-001", scheme: "PM Gram Sadak Yojana", sanctioned: "₹2,500 Cr", released: "₹1,800 Cr", spent: "₹1,520 Cr", spentPercent: "84%", status: "active" },
    { id: "sch-002", scheme: "Swachh Bharat Mission (Gramin)", sanctioned: "₹1,200 Cr", released: "₹980 Cr", spent: "₹945 Cr", spentPercent: "96%", status: "active" },
    { id: "sch-003", scheme: "MGNREGA", sanctioned: "₹4,800 Cr", released: "₹3,600 Cr", spent: "₹2,850 Cr", spentPercent: "79%", status: "active" },
    { id: "sch-004", scheme: "National Health Mission", sanctioned: "₹1,800 Cr", released: "₹1,200 Cr", spent: "₹980 Cr", spentPercent: "82%", status: "active" },
    { id: "sch-005", scheme: "PM Awas Yojana", sanctioned: "₹3,200 Cr", released: "₹2,400 Cr", spent: "₹1,680 Cr", spentPercent: "70%", status: "pending" },
    { id: "sch-006", scheme: "Samagra Shiksha Abhiyan", sanctioned: "₹950 Cr", released: "₹720 Cr", spent: "₹640 Cr", spentPercent: "89%", status: "active" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Scheme Expenditure Tracking" subtitle="Track sanctioned, released, and spent amounts across government schemes." back="/finance" />
      <StatGrid>
        <StatCard icon="📋" iconBg="#e7edfd" label="Active Schemes" value={42} />
        <StatCard icon="₹" iconBg="#ecfdf3" label="Total Sanctioned" value="₹14,450 Cr" />
        <StatCard icon="📤" iconBg="#fffaeb" label="Released" value="₹10,700 Cr" />
        <StatCard icon="📊" iconBg="#eff6ff" label="Avg. Spent" value="82%" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Scheme Expenditure</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="📋" title="No schemes" message="No scheme tracking data available." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "scheme", label: "Scheme" },
              { key: "sanctioned", label: "Sanctioned", align: "right" },
              { key: "released", label: "Released", align: "right" },
              { key: "spent", label: "Spent", align: "right" },
              { key: "spentPercent", label: "Spent %", align: "right" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
            rowLinkKey="id"
            rowLinkPrefix="/finance/expenditure/scheme-tracking/"
          />
        )}
      </div>
    </main>
  );
}
