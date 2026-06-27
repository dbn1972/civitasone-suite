import { PageHeader, StatGrid, StatCard, DataTable, EmptyState } from "@/app/_components/ds";

export default function DeductionsPage() {
  type Row = { billNo: string; vendor: string; tds: string; incomeTax: string; gst: string; net: string; [k: string]: unknown };
  const rows: Row[] = [
    { billNo: "BILL/2025/0456", vendor: "M/s Tata Projects Ltd", tds: "₹2,45,000", incomeTax: "₹1,22,500", gst: "₹4,41,000", net: "₹16,91,500" },
    { billNo: "BILL/2025/0457", vendor: "Bharat Electronics Ltd", tds: "₹87,500", incomeTax: "₹43,750", gst: "₹1,57,500", net: "₹6,11,250" },
    { billNo: "BILL/2025/0458", vendor: "HCL Infosystems Ltd", tds: "₹32,000", incomeTax: "₹16,000", gst: "₹57,600", net: "₹2,14,400" },
    { billNo: "BILL/2025/0459", vendor: "NBCC India Ltd", tds: "₹5,60,000", incomeTax: "₹2,80,000", gst: "₹10,08,000", net: "₹48,52,000" },
    { billNo: "BILL/2025/0460", vendor: "Wipro Infrastructure", tds: "₹1,58,000", incomeTax: "₹79,000", gst: "₹2,84,400", net: "₹10,78,600" },
    { billNo: "BILL/2025/0461", vendor: "L&T Construction", tds: "₹12,00,000", incomeTax: "₹6,00,000", gst: "₹21,60,000", net: "₹1,02,40,000" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Deduction Register" subtitle="Statutory deductions (TDS, IT, GST) applied on vendor bills before payment." back="/finance" />
      <StatGrid>
        <StatCard icon="🧮" iconBg="#e7edfd" label="Bills with Deductions" value={312} />
        <StatCard icon="📋" iconBg="#ecfdf3" label="TDS Deducted (MTD)" value="₹1.8 Cr" />
        <StatCard icon="💰" iconBg="#fffaeb" label="GST Withheld" value="₹3.2 Cr" />
        <StatCard icon="₹" iconBg="#eff6ff" label="Net Payments" value="₹22.4 Cr" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Deduction Register</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="🧮" title="No records" message="No deduction records found." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "billNo", label: "Bill No" },
              { key: "vendor", label: "Vendor" },
              { key: "tds", label: "TDS", align: "right" },
              { key: "incomeTax", label: "IT", align: "right" },
              { key: "gst", label: "GST", align: "right" },
              { key: "net", label: "Net Payable", align: "right" },
            ]}
            rows={rows}
          />
        )}
      </div>
    </main>
  );
}
