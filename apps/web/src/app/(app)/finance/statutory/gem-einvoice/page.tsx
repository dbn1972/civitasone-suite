import { PageHeader, StatGrid, StatCard, DataTable, EmptyState } from "@/app/_components/ds";

export default function GemEInvoicePage() {
  type Row = { invoiceNo: string; supplier: string; irn: string; amount: string; gemOrderId: string; status: string; [k: string]: unknown };
  const rows: Row[] = [
    { invoiceNo: "INV/2025/00456", supplier: "M/s Tata Projects Ltd", irn: "29AAACT1234A1Z520250115...", amount: "₹24,50,000", gemOrderId: "GEMC-511687-2025", status: "approved" },
    { invoiceNo: "INV/2025/00457", supplier: "Bharat Electronics Ltd", irn: "29AABCB5678B1ZK20250114...", amount: "₹8,75,000", gemOrderId: "GEMC-511688-2025", status: "approved" },
    { invoiceNo: "INV/2025/00458", supplier: "HCL Infosystems Ltd", irn: "07AAACH9012C1ZL20250113...", amount: "₹3,20,000", gemOrderId: "GEMC-511689-2025", status: "pending" },
    { invoiceNo: "INV/2025/00459", supplier: "HP India Sales Pvt Ltd", irn: "07AABCH3456D1ZM20250112...", amount: "₹15,80,000", gemOrderId: "GEMC-511690-2025", status: "approved" },
    { invoiceNo: "INV/2025/00460", supplier: "Dell Technologies India", irn: "29AABCD7890E1ZN20250111...", amount: "₹42,00,000", gemOrderId: "GEMC-511691-2025", status: "approved" },
    { invoiceNo: "INV/2025/00461", supplier: "Canon India Pvt Ltd", irn: "27AABCC2345F1ZP20250110...", amount: "₹6,50,000", gemOrderId: "—", status: "pending" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="GeM & e-Invoice" subtitle="Government e-Marketplace orders and IRN-validated e-invoices." back="/finance" />
      <StatGrid>
        <StatCard icon="🛒" iconBg="#e7edfd" label="GeM Orders" value={186} />
        <StatCard icon="📄" iconBg="#ecfdf3" label="e-Invoices" value={312} />
        <StatCard icon="✅" iconBg="#fffaeb" label="IRN Validated" value={298} />
        <StatCard icon="₹" iconBg="#eff6ff" label="Total Value" value="₹18.4 Cr" />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>e-Invoices</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="🛒" title="No invoices" message="No GeM/e-Invoice records found." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "invoiceNo", label: "Invoice No" },
              { key: "supplier", label: "Supplier" },
              { key: "irn", label: "IRN" },
              { key: "amount", label: "Amount", align: "right" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
          />
        )}
      </div>
    </main>
  );
}
