import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default function InvoicesPage() {
  type Row = { tenant: string; period: string; amount: number; status: string; paidDate: string };

  const rows: Row[] = [
    { tenant: "Rajasthan Urban Dev Authority", period: "Jan 2025", amount: 850000, status: "Paid", paidDate: "2025-02-05" },
    { tenant: "Madhya Pradesh PWD", period: "Jan 2025", amount: 620000, status: "Paid", paidDate: "2025-02-03" },
    { tenant: "Gujarat Industrial Dev Corp", period: "Jan 2025", amount: 450000, status: "Pending", paidDate: "—" },
    { tenant: "Kerala IT Mission", period: "Jan 2025", amount: 380000, status: "Paid", paidDate: "2025-02-07" },
    { tenant: "UP Jal Nigam", period: "Dec 2024", amount: 520000, status: "Overdue", paidDate: "—" },
    { tenant: "Chhattisgarh Housing Board", period: "Jan 2025", amount: 150000, status: "Paid", paidDate: "2025-01-28" },
    { tenant: "Haryana State Electronics Corp", period: "Jan 2025", amount: 280000, status: "Pending", paidDate: "—" },
    { tenant: "Municipal Corp Greater Mumbai", period: "Jan 2025", amount: 0, status: "Trial", paidDate: "—" },
  ];

  const columns = [
    { key: "tenant" as const, label: "Tenant" },
    { key: "period" as const, label: "Period" },
    { key: "amount" as const, label: "Amount (₹)", align: "right" as const, cellType: "amount" as const },
    { key: "status" as const, label: "Status", cellType: "status" as const },
    { key: "paidDate" as const, label: "Paid Date" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="SA Invoices" subtitle="Tenant billing invoices with payment tracking." back="/admin" />
      <StatGrid>
        <StatCard icon="🧾" iconBg="#eef2ff" label="Total Invoices" value={8} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Paid" value={4} />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={2} />
        <StatCard icon="🚨" iconBg="#fce7ee" label="Overdue" value={1} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Invoice Register</h3></div>
        <DataTable columns={columns} rows={rows} sortable filterable />
      </div>
    </main>
  );
}
