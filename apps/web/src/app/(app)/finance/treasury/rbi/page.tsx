import { PageHeader, StatGrid, StatCard, DataTable, EmptyState } from "@/app/_components/ds";

export default function RbiTreasuryPage() {
  type Row = { instrument: string; type: string; faceValue: string; maturityDate: string; yieldPercent: string; status: string; [k: string]: unknown };
  const rows: Row[] = [
    { instrument: "TB-91D-2025-001", type: "Treasury Bill (91 Day)", faceValue: "₹5,00,00,000", maturityDate: "15-Apr-2025", yieldPercent: "6.85%", status: "active" },
    { instrument: "GB-10Y-2024-045", type: "Government Bond (10Y)", faceValue: "₹10,00,00,000", maturityDate: "22-Dec-2034", yieldPercent: "7.18%", status: "active" },
    { instrument: "TB-364D-2024-012", type: "Treasury Bill (364 Day)", faceValue: "₹2,50,00,000", maturityDate: "01-Mar-2025", yieldPercent: "6.92%", status: "active" },
    { instrument: "FD-SBI-2024-078", type: "Term Deposit", faceValue: "₹8,00,00,000", maturityDate: "30-Jun-2025", yieldPercent: "7.25%", status: "active" },
    { instrument: "GB-5Y-2023-019", type: "Government Bond (5Y)", faceValue: "₹3,00,00,000", maturityDate: "15-Sep-2028", yieldPercent: "7.05%", status: "active" },
    { instrument: "TB-182D-2025-003", type: "Treasury Bill (182 Day)", faceValue: "₹4,00,00,000", maturityDate: "10-Jul-2025", yieldPercent: "6.78%", status: "pending" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="RBI / Treasury Operations" subtitle="Treasury bills, government bonds, and term deposit investments." back="/finance" />
      <StatGrid>
        <StatCard icon="🏦" iconBg="#e7edfd" label="Total Instruments" value={46} />
        <StatCard icon="₹" iconBg="#ecfdf3" label="Portfolio Value" value="₹32.5 Cr" />
        <StatCard icon="📈" iconBg="#fffaeb" label="Avg. Yield" value="7.01%" />
        <StatCard icon="📅" iconBg="#fce7ee" label="Maturing (30d)" value={4} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Instruments</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="🏦" title="No instruments" message="No treasury instruments found." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "instrument", label: "Instrument ID" },
              { key: "type", label: "Type" },
              { key: "faceValue", label: "Face Value", align: "right" },
              { key: "maturityDate", label: "Maturity Date" },
              { key: "yieldPercent", label: "Yield %", align: "right" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
          />
        )}
      </div>
    </main>
  );
}
