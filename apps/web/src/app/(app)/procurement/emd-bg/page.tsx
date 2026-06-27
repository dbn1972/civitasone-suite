import { PageHeader, StatGrid, StatCard, DataTable } from "@/app/_components/ds";

export default function EmdBgPage() {
  type Row = { vendor: string; type: string; amount: number; validity: string; bank: string; status: string };

  const rows: Row[] = [
    { vendor: "Aravali Constructions Pvt Ltd", type: "EMD", amount: 500000, validity: "2025-06-30", bank: "State Bank of India", status: "Active" },
    { vendor: "Bharat Infrastructure Ltd", type: "Bank Guarantee", amount: 2500000, validity: "2025-12-15", bank: "Punjab National Bank", status: "Active" },
    { vendor: "DigiGov Solutions", type: "EMD", amount: 200000, validity: "2025-03-01", bank: "Bank of Baroda", status: "Expired" },
    { vendor: "MedEquip Healthcare", type: "Bank Guarantee", amount: 1800000, validity: "2025-09-20", bank: "HDFC Bank", status: "Active" },
    { vendor: "PowerGrid Solutions", type: "EMD", amount: 750000, validity: "2025-04-15", bank: "Canara Bank", status: "Released" },
    { vendor: "Surgipharma India", type: "Bank Guarantee", amount: 3200000, validity: "2026-01-10", bank: "Union Bank of India", status: "Active" },
    { vendor: "TechServe India", type: "EMD", amount: 300000, validity: "2025-02-28", bank: "Indian Bank", status: "Forfeited" },
    { vendor: "Vikram Solar Ltd", type: "Bank Guarantee", amount: 1500000, validity: "2025-08-30", bank: "ICICI Bank", status: "Active" },
  ];

  const columns = [
    { key: "vendor" as const, label: "Vendor" },
    { key: "type" as const, label: "Type" },
    { key: "amount" as const, label: "Amount (₹)", align: "right" as const, cellType: "amount" as const },
    { key: "validity" as const, label: "Valid Until" },
    { key: "bank" as const, label: "Bank" },
    { key: "status" as const, label: "Status", cellType: "status" as const },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="EMD & Bank Guarantees" subtitle="Earnest money deposits and bank guarantee register for procurement security." back="/procurement" />
      <StatGrid>
        <StatCard icon="🏦" iconBg="#eef2ff" label="Active Guarantees" value={5} />
        <StatCard icon="💵" iconBg="#ecfdf3" label="Total Value" value="₹1.08 Cr" />
        <StatCard icon="⚠️" iconBg="#fffaeb" label="Expiring Soon" value={1} />
        <StatCard icon="🚫" iconBg="#fce7ee" label="Forfeited" value={1} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>EMD & BG Register</h3></div>
        <DataTable columns={columns} rows={rows} sortable filterable />
      </div>
    </main>
  );
}
