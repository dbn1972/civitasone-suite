import { PageHeader, StatGrid, StatCard, DataTable, EmptyState } from "@/app/_components/ds";

export default function AllocationPage() {
  type Row = { department: string; allocated: string; released: string; utilized: string; utilPercent: string; status: string; [k: string]: unknown };
  const rows: Row[] = [
    { department: "Public Works Department", allocated: "₹2,400 Cr", released: "₹1,800 Cr", utilized: "₹1,520 Cr", utilPercent: "84%", status: "active" },
    { department: "Health & Family Welfare", allocated: "₹1,200 Cr", released: "₹950 Cr", utilized: "₹890 Cr", utilPercent: "94%", status: "active" },
    { department: "Education", allocated: "₹3,500 Cr", released: "₹2,600 Cr", utilized: "₹2,100 Cr", utilPercent: "81%", status: "active" },
    { department: "Agriculture & Farmers", allocated: "₹850 Cr", released: "₹680 Cr", utilized: "₹450 Cr", utilPercent: "66%", status: "pending" },
    { department: "Rural Development", allocated: "₹1,800 Cr", released: "₹1,400 Cr", utilized: "₹1,250 Cr", utilPercent: "89%", status: "active" },
    { department: "Urban Development", allocated: "₹980 Cr", released: "₹720 Cr", utilized: "₹580 Cr", utilPercent: "81%", status: "active" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Budget Allocation" subtitle="Department-wise budget allocation, release, and utilization tracking." back="/finance" />
      <StatGrid>
        <StatCard icon="💰" iconBg="#e7edfd" label="Total Allocated" value="₹10,730 Cr" />
        <StatCard icon="📤" iconBg="#ecfdf3" label="Released" value="₹8,150 Cr" />
        <StatCard icon="📊" iconBg="#fffaeb" label="Utilized" value="₹6,790 Cr" />
        <StatCard icon="📈" iconBg="#eff6ff" label="Avg. Utilization" value="83%" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Budget Allocation by Department</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="💰" title="No data" message="No budget allocation data available." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "department", label: "Department" },
              { key: "allocated", label: "Allocated", align: "right" },
              { key: "released", label: "Released", align: "right" },
              { key: "utilized", label: "Utilized", align: "right" },
              { key: "utilPercent", label: "Util. %", align: "right" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
          />
        )}
      </div>
    </main>
  );
}
