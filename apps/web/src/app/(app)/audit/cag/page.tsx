import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default function CagPage() {
  type Row = { reportYear: string; totalParas: number; settled: number; pending: number; department: string; status: string };

  const rows: Row[] = [
    { reportYear: "2023-24", totalParas: 18, settled: 5, pending: 13, department: "Public Works", status: "Under Review" },
    { reportYear: "2023-24", totalParas: 12, settled: 8, pending: 4, department: "Finance", status: "Partially Settled" },
    { reportYear: "2022-23", totalParas: 22, settled: 19, pending: 3, department: "Education", status: "Nearly Settled" },
    { reportYear: "2022-23", totalParas: 9, settled: 9, pending: 0, department: "Health & Family Welfare", status: "Settled" },
    { reportYear: "2021-22", totalParas: 15, settled: 14, pending: 1, department: "Revenue", status: "Nearly Settled" },
    { reportYear: "2023-24", totalParas: 7, settled: 2, pending: 5, department: "Urban Development", status: "Under Review" },
    { reportYear: "2021-22", totalParas: 11, settled: 11, pending: 0, department: "Agriculture", status: "Settled" },
  ];

  const columns = [
    { key: "reportYear" as const, label: "Report Year" },
    { key: "totalParas" as const, label: "Total Paras", align: "center" as const },
    { key: "settled" as const, label: "Settled", align: "center" as const },
    { key: "pending" as const, label: "Pending", align: "center" as const },
    { key: "department" as const, label: "Department" },
    { key: "status" as const, label: "Status", cellType: "status" as const },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="CAG Audit Interaction" subtitle="Comptroller and Auditor General audit paragraphs and settlement tracking." back="/audit" />
      <StatGrid>
        <StatCard icon="📜" iconBg="#eef2ff" label="Total Paras" value={94} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Settled" value={68} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={26} />
        <StatCard icon="🏛️" iconBg="#fce7ee" label="Departments" value={7} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>CAG Audit Paragraphs</h3></div>
        <DataTable columns={columns} rows={rows} sortable filterable />
      </div>
    </main>
  );
}
