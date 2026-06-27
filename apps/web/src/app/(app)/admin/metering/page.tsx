import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default function MeteringPage() {
  type Row = { tenant: string; apiCalls: string; storage: string; users: number; billingPeriod: string; amount: number; status: string };

  const rows: Row[] = [
    { tenant: "Rajasthan Urban Dev Authority", apiCalls: "4,52,000", storage: "3.2 GB", users: 1250, billingPeriod: "Feb 2025", amount: 850000, status: "Billed" },
    { tenant: "Madhya Pradesh PWD", apiCalls: "3,12,000", storage: "2.1 GB", users: 890, billingPeriod: "Feb 2025", amount: 620000, status: "Billed" },
    { tenant: "Gujarat Industrial Dev Corp", apiCalls: "1,89,000", storage: "1.4 GB", users: 520, billingPeriod: "Feb 2025", amount: 450000, status: "Pending" },
    { tenant: "Haryana State Electronics Corp", apiCalls: "98,000", storage: "680 MB", users: 340, billingPeriod: "Feb 2025", amount: 280000, status: "Pending" },
    { tenant: "Chhattisgarh Housing Board", apiCalls: "56,000", storage: "420 MB", users: 180, billingPeriod: "Feb 2025", amount: 150000, status: "Pending" },
    { tenant: "Kerala IT Mission", apiCalls: "1,45,000", storage: "1.1 GB", users: 410, billingPeriod: "Feb 2025", amount: 380000, status: "Billed" },
    { tenant: "UP Jal Nigam", apiCalls: "2,34,000", storage: "1.8 GB", users: 720, billingPeriod: "Jan 2025", amount: 520000, status: "Overdue" },
  ];

  const columns = [
    { key: "tenant" as const, label: "Tenant" },
    { key: "apiCalls" as const, label: "API Calls" },
    { key: "storage" as const, label: "Storage" },
    { key: "users" as const, label: "Users", align: "right" as const },
    { key: "billingPeriod" as const, label: "Billing Period" },
    { key: "amount" as const, label: "Amount (₹)", align: "right" as const, cellType: "amount" as const },
    { key: "status" as const, label: "Status", cellType: "status" as const },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Usage Metering" subtitle="Per-tenant resource consumption and billing details." back="/admin" />
      <StatGrid>
        <StatCard icon="📊" iconBg="#eef2ff" label="Total API Calls" value="14.8M" />
        <StatCard icon="💾" iconBg="#ecfdf3" label="Total Storage" value="10.7 GB" />
        <StatCard icon="💰" iconBg="#fffaeb" label="Monthly Revenue" value="₹32.5L" />
        <StatCard icon="⚠️" iconBg="#fce7ee" label="Overdue" value={1} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Usage & Billing</h3></div>
        <DataTable columns={columns} rows={rows} sortable filterable />
      </div>
    </main>
  );
}
