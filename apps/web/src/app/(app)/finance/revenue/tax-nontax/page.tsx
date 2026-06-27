import { PageHeader, StatGrid, StatCard, DataTable, EmptyState } from "@/app/_components/ds";

export default function TaxNonTaxPage() {
  type Row = { head: string; category: string; budget: string; actual: string; variance: string; status: string; [k: string]: unknown };
  const rows: Row[] = [
    { head: "0030-Stamps & Registration", category: "Tax", budget: "₹450 Cr", actual: "₹312 Cr", variance: "-30.7%", status: "pending" },
    { head: "0035-Taxes on Property", category: "Tax", budget: "₹280 Cr", actual: "₹265 Cr", variance: "-5.4%", status: "approved" },
    { head: "0041-Taxes on Vehicles", category: "Tax", budget: "₹180 Cr", actual: "₹192 Cr", variance: "+6.7%", status: "approved" },
    { head: "0049-Interest Receipts", category: "Non-Tax", budget: "₹85 Cr", actual: "₹72 Cr", variance: "-15.3%", status: "pending" },
    { head: "0059-Public Works", category: "Non-Tax", budget: "₹45 Cr", actual: "₹38 Cr", variance: "-15.6%", status: "pending" },
    { head: "0070-Other Admin Services", category: "Non-Tax", budget: "₹120 Cr", actual: "₹108 Cr", variance: "-10.0%", status: "approved" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Tax & Non-Tax Revenue" subtitle="Budget vs actual revenue performance by head of account." back="/finance" />
      <StatGrid>
        <StatCard icon="💰" iconBg="#ecfdf3" label="Total Budget" value="₹1,160 Cr" />
        <StatCard icon="📊" iconBg="#e7edfd" label="Actual" value="₹987 Cr" />
        <StatCard icon="📉" iconBg="#fce7ee" label="Variance" value="-14.9%" />
        <StatCard icon="📋" iconBg="#fffaeb" label="Revenue Heads" value={42} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Revenue by Head</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="💰" title="No data" message="No tax/non-tax revenue data available." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "head", label: "Head of Account" },
              { key: "category", label: "Category" },
              { key: "budget", label: "Budget", align: "right" },
              { key: "actual", label: "Actual", align: "right" },
              { key: "variance", label: "Variance %", align: "right" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
          />
        )}
      </div>
    </main>
  );
}
