import { PageHeader, StatGrid, StatCard, DataTable } from "../../../../_components/ds";

type Row = {
  id: string;
  employee: string;
  department: string;
  arrearType: string;
  period: string;
  amount: string;
  payableMonth: string;
  status: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", employee: "Rajesh Verma", department: "Finance", arrearType: "DA Revision", period: "Jan 2024 – Jun 2024", amount: "₹42,000", payableMonth: "Jul 2024", status: "approved" },
  { id: "2", employee: "Priya Sharma", department: "HR", arrearType: "DA Revision", period: "Jan 2024 – Jun 2024", amount: "₹36,000", payableMonth: "Jul 2024", status: "approved" },
  { id: "3", employee: "Amit Patel", department: "IT", arrearType: "Promotion Arrear", period: "Apr 2024 – Jun 2024", amount: "₹28,500", payableMonth: "Jul 2024", status: "pending" },
  { id: "4", employee: "Sunita Rao", department: "Legal", arrearType: "DA Revision", period: "Jan 2024 – Jun 2024", amount: "₹38,000", payableMonth: "Jul 2024", status: "approved" },
  { id: "5", employee: "Vikram Singh", department: "Admin", arrearType: "Pay Fixation", period: "Jan 2024 – Mar 2024", amount: "₹15,600", payableMonth: "Aug 2024", status: "pending" },
  { id: "6", employee: "Deepak Kumar", department: "IT", arrearType: "DA Revision", period: "Jan 2024 – Jun 2024", amount: "₹30,000", payableMonth: "Jul 2024", status: "completed" },
  { id: "7", employee: "Meera Iyer", department: "Accounts", arrearType: "HRA Arrear", period: "Apr 2024 – Jun 2024", amount: "₹18,000", payableMonth: "Jul 2024", status: "approved" },
];

export default function ArrearsPage() {
  const approved = items.filter((i) => i.status === "approved").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const totalAmount = "₹2,08,100";

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "arrearType", label: "Arrear Type" },
    { key: "period", label: "Period" },
    { key: "amount", label: "Amount" },
    { key: "payableMonth", label: "Payable In" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Arrears Computation" subtitle="Arrears due to DA revision, promotions, and pay fixation." back="/hr" />
      <StatGrid>
        <StatCard icon="💰" iconBg="#e6f0ff" label="Total Entries" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Approved" value={approved} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="📊" iconBg="#f5f5f5" label="Total Arrears" value={totalAmount} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Arrears Register</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee, type or period…" pageSize={15} />
      </div>
    </main>
  );
}
