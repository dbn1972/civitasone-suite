import { PageHeader, StatGrid, StatCard, DataTable, EmptyState } from "@/app/_components/ds";

export default function DbtPage() {
  type Row = { scheme: string; beneficiary: string; aadhaar: string; amount: string; status: string; date: string; [k: string]: unknown };
  const rows: Row[] = [
    { scheme: "PM-KISAN", beneficiary: "Ramesh Kumar", aadhaar: "XXXX-XXXX-4567", amount: "₹6,000", status: "approved", date: "15-Jan-2025" },
    { scheme: "PM Awas Yojana", beneficiary: "Sunita Devi", aadhaar: "XXXX-XXXX-7891", amount: "₹1,50,000", status: "approved", date: "14-Jan-2025" },
    { scheme: "Scholarship (SC/ST)", beneficiary: "Arvind Paswan", aadhaar: "XXXX-XXXX-2345", amount: "₹25,000", status: "pending", date: "13-Jan-2025" },
    { scheme: "Old Age Pension", beneficiary: "Kamla Prasad", aadhaar: "XXXX-XXXX-6789", amount: "₹3,000", status: "approved", date: "12-Jan-2025" },
    { scheme: "Ujjwala Yojana", beneficiary: "Meera Kumari", aadhaar: "XXXX-XXXX-1234", amount: "₹1,600", status: "rejected", date: "11-Jan-2025" },
    { scheme: "PM-KISAN", beneficiary: "Suresh Yadav", aadhaar: "XXXX-XXXX-8901", amount: "₹6,000", status: "approved", date: "10-Jan-2025" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="DBT Beneficiaries" subtitle="Direct Benefit Transfer tracking with Aadhaar-linked beneficiary verification." back="/finance" />
      <StatGrid>
        <StatCard icon="🎯" iconBg="#e7edfd" label="Total Beneficiaries" value="12,458" />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Transferred" value="11,892" />
        <StatCard icon="⏳" iconBg="#fffaeb" label="Pending" value={456} />
        <StatCard icon="₹" iconBg="#eff6ff" label="Total Disbursed" value="₹8.2 Cr" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>DBT Transactions</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="🎯" title="No records" message="No DBT beneficiary records found." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "scheme", label: "Scheme" },
              { key: "beneficiary", label: "Beneficiary" },
              { key: "aadhaar", label: "Aadhaar (Masked)" },
              { key: "amount", label: "Amount", align: "right" },
              { key: "status", label: "Status", cellType: "status" },
              { key: "date", label: "Date" },
            ]}
            rows={rows}
          />
        )}
      </div>
    </main>
  );
}
