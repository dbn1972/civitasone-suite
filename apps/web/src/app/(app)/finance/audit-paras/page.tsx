import { PageHeader, StatGrid, StatCard, DataTable, EmptyState } from "@/app/_components/ds";

export default function AuditParasPage() {
  type Row = { id: string; paraNo: string; year: string; amount: string; department: string; status: string; [k: string]: unknown };
  const rows: Row[] = [
    { id: "ap-001", paraNo: "AP/2024/001", year: "2023-24", amount: "₹4,50,00,000", department: "Public Works", status: "pending" },
    { id: "ap-002", paraNo: "AP/2024/002", year: "2023-24", amount: "₹1,25,00,000", department: "Health & FW", status: "active" },
    { id: "ap-003", paraNo: "AP/2024/003", year: "2023-24", amount: "₹8,90,00,000", department: "Education", status: "pending" },
    { id: "ap-004", paraNo: "AP/2023/045", year: "2022-23", amount: "₹2,30,00,000", department: "Agriculture", status: "approved" },
    { id: "ap-005", paraNo: "AP/2023/046", year: "2022-23", amount: "₹67,00,000", department: "Rural Development", status: "approved" },
    { id: "ap-006", paraNo: "AP/2024/004", year: "2023-24", amount: "₹3,15,00,000", department: "Urban Development", status: "pending" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Finance Audit Paras" subtitle="CAG audit observations with department-wise response tracking." back="/finance" />
      <StatGrid>
        <StatCard icon="🔍" iconBg="#e7edfd" label="Total Paras" value={68} />
        <StatCard icon="⏳" iconBg="#fce7ee" label="Pending Reply" value={32} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Settled" value={28} />
        <StatCard icon="₹" iconBg="#fffaeb" label="Amount Involved" value="₹142 Cr" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Audit Paras</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="🔍" title="No paras" message="No audit paras found." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "paraNo", label: "Para No" },
              { key: "year", label: "Year" },
              { key: "amount", label: "Amount", align: "right" },
              { key: "department", label: "Department" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
            rowLinkKey="id"
            rowLinkPrefix="/finance/audit-paras/"
          />
        )}
      </div>
    </main>
  );
}
