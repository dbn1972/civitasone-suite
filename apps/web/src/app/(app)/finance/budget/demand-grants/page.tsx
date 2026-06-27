import { PageHeader, StatGrid, StatCard, DataTable, EmptyState } from "@/app/_components/ds";

export default function DemandGrantsPage() {
  type Row = { demandNo: string; ministry: string; voted: string; charged: string; total: string; status: string; [k: string]: unknown };
  const rows: Row[] = [
    { demandNo: "Demand 16", ministry: "Ministry of Health & FW", voted: "₹89,155 Cr", charged: "₹12 Cr", total: "₹89,167 Cr", status: "approved" },
    { demandNo: "Demand 27", ministry: "Ministry of Education", voted: "₹1,12,899 Cr", charged: "₹8 Cr", total: "₹1,12,907 Cr", status: "approved" },
    { demandNo: "Demand 82", ministry: "Ministry of Road Transport", voted: "₹2,70,435 Cr", charged: "₹45 Cr", total: "₹2,70,480 Cr", status: "approved" },
    { demandNo: "Demand 01", ministry: "Ministry of Agriculture", voted: "₹1,25,036 Cr", charged: "₹5 Cr", total: "₹1,25,041 Cr", status: "approved" },
    { demandNo: "Demand 54", ministry: "Ministry of Defence", voted: "₹5,93,538 Cr", charged: "₹1,200 Cr", total: "₹5,94,738 Cr", status: "pending" },
    { demandNo: "Demand 71", ministry: "Ministry of Railways", voted: "₹2,52,200 Cr", charged: "₹980 Cr", total: "₹2,53,180 Cr", status: "approved" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Demand for Grants" subtitle="Parliamentary demand for grants with voted and charged appropriations." back="/finance" />
      <StatGrid>
        <StatCard icon="🏛️" iconBg="#e7edfd" label="Total Demands" value={100} />
        <StatCard icon="✅" iconBg="#ecfdf3" label="Approved" value={96} />
        <StatCard icon="₹" iconBg="#fffaeb" label="Total Voted" value="₹44.9 L Cr" />
        <StatCard icon="📊" iconBg="#eff6ff" label="Total Charged" value="₹8,450 Cr" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Demands for Grants</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="🏛️" title="No demands" message="No demand for grants found." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "demandNo", label: "Demand No" },
              { key: "ministry", label: "Ministry / Department" },
              { key: "voted", label: "Voted", align: "right" },
              { key: "charged", label: "Charged", align: "right" },
              { key: "total", label: "Total", align: "right" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
          />
        )}
      </div>
    </main>
  );
}
