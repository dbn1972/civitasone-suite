import { PageHeader, StatGrid, StatCard, DataTable, EmptyState } from "@/app/_components/ds";

export default function TdsReturnsPage() {
  type Row = { quarter: string; form: string; filedDate: string; formsIssued: number; tdsAmount: string; status: string; [k: string]: unknown };
  const rows: Row[] = [
    { quarter: "Q3 FY24-25 (Oct-Dec)", form: "26Q", filedDate: "15-Jan-2025", formsIssued: 186, tdsAmount: "₹4,25,00,000", status: "approved" },
    { quarter: "Q2 FY24-25 (Jul-Sep)", form: "26Q", filedDate: "15-Oct-2024", formsIssued: 174, tdsAmount: "₹3,89,00,000", status: "approved" },
    { quarter: "Q1 FY24-25 (Apr-Jun)", form: "26Q", filedDate: "15-Jul-2024", formsIssued: 168, tdsAmount: "₹3,56,00,000", status: "approved" },
    { quarter: "Q3 FY24-25 (Oct-Dec)", form: "24Q (Salary)", filedDate: "15-Jan-2025", formsIssued: 2450, tdsAmount: "₹8,90,00,000", status: "approved" },
    { quarter: "Q2 FY24-25 (Jul-Sep)", form: "24Q (Salary)", filedDate: "15-Oct-2024", formsIssued: 2420, tdsAmount: "₹8,75,00,000", status: "approved" },
    { quarter: "Q4 FY24-25 (Jan-Mar)", form: "26Q", filedDate: "—", formsIssued: 0, tdsAmount: "—", status: "pending" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="TDS Returns & Form 16A" subtitle="Quarterly TDS return filing status and Form 16/16A issuance tracking." back="/finance" />
      <StatGrid>
        <StatCard icon="📋" iconBg="#e7edfd" label="Returns Filed (FY)" value={6} />
        <StatCard icon="📄" iconBg="#ecfdf3" label="Forms Issued" value="5,398" />
        <StatCard icon="₹" iconBg="#fffaeb" label="TDS Deposited" value="₹29.35 Cr" />
        <StatCard icon="⏳" iconBg="#fce7ee" label="Pending Q4" value={2} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>TDS Returns</h3></div>
        {rows.length === 0 ? (
          <EmptyState icon="📋" title="No returns" message="No TDS return records found." />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "quarter", label: "Quarter" },
              { key: "form", label: "Form" },
              { key: "filedDate", label: "Filed Date" },
              { key: "formsIssued", label: "Forms Issued", align: "right" },
              { key: "tdsAmount", label: "TDS Amount", align: "right" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
          />
        )}
      </div>
    </main>
  );
}
