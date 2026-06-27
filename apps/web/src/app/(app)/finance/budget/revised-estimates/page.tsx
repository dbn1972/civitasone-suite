import { PageHeader, StatGrid, StatCard, DataTable, EmptyState } from "@/app/_components/ds";

export default function RevisedEstimatesPage() {
  type Row = { head: string; be: string; re: string; variance: string; reason: string; status: string; [k: string]: unknown };
  const rows: Row[] = [
    { head: "2401-Crop Husbandry", be: "₹850 Cr", re: "₹920 Cr", variance: "+8.2%", reason: "Enhanced subsidy allocation", status: "approved" },
    { head: "3054-Roads & Bridges", be: "₹2,400 Cr", re: "₹2,180 Cr", variance: "-9.2%", reason: "Project delays in NH expansion", status: "approved" },
    { head: "2210-Medical & PH", be: "₹1,200 Cr", re: "₹1,350 Cr", variance: "+12.5%", reason: "COVID infrastructure augmentation", status: "pending" },
    { head: "2202-General Education", be: "₹3,500 Cr", re: "₹3,420 Cr", variance: "-2.3%", reason: "Savings in establishment cost", status: "approved" },
    { head: "2215-Water Supply", be: "₹680 Cr", re: "₹750 Cr", variance: "+10.3%", reason: "Jal Jeevan Mission acceleration", status: "approved" },
    { head: "2501-Special Programmes", be: "₹450 Cr", re: "₹380 Cr", variance: "-15.6%", reason: "Lower utilization by districts", status: "pending" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Revised Estimates" subtitle="Budget estimates vs revised estimates with variance analysis." back="/finance" />
      <StatGrid>
        <StatCard icon="📊" iconBg="#e7edfd" label="Heads Revised" value={78} />
        <StatCard icon="📈" iconBg="#ecfdf3" label="Upward Revisions" value={34} />
        <StatCard icon="📉" iconBg="#fce7ee" label="Downward" value={44} />
        <StatCard icon="₹" iconBg="#fffaeb" label="Net RE Change" value="+₹2,450 Cr" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Revised Estimates FY 2024-25</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="📊" title="No data" message="No revised estimate data available." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "head", label: "Head of Account" },
              { key: "be", label: "BE", align: "right" },
              { key: "re", label: "RE", align: "right" },
              { key: "variance", label: "Variance", align: "right" },
              { key: "reason", label: "Reason" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
          />
        )}
      </div>
    </main>
  );
}
