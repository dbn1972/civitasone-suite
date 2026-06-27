import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";

type Row = {
  id: string;
  employee: string;
  department: string;
  fromGrade: string;
  toGrade: string;
  effectiveDate: string;
  orderNo: string;
  status: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", employee: "Priya Sharma", department: "HR", fromGrade: "Level 7", toGrade: "Level 8", effectiveDate: "01/04/2024", orderNo: "PR/2024/0112", status: "approved" },
  { id: "2", employee: "Amit Patel", department: "IT", fromGrade: "Level 8", toGrade: "Level 9", effectiveDate: "01/04/2024", orderNo: "PR/2024/0113", status: "approved" },
  { id: "3", employee: "Sunita Rao", department: "Legal", fromGrade: "Level 10", toGrade: "Level 11", effectiveDate: "01/07/2024", orderNo: "PR/2024/0187", status: "pending" },
  { id: "4", employee: "Vikram Singh", department: "Admin", fromGrade: "Level 5", toGrade: "Level 6", effectiveDate: "01/04/2024", orderNo: "PR/2024/0114", status: "approved" },
  { id: "5", employee: "Deepak Kumar", department: "IT", fromGrade: "Level 9", toGrade: "Level 10", effectiveDate: "01/07/2024", orderNo: "PR/2024/0188", status: "pending" },
  { id: "6", employee: "Kavita Nair", department: "Finance", fromGrade: "Level 6", toGrade: "Level 7", effectiveDate: "01/01/2024", orderNo: "PR/2024/0045", status: "completed" },
];

export default function PromotionPage() {
  const approved = items.filter((i) => i.status === "approved").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const completed = items.filter((i) => i.status === "completed").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "fromGrade", label: "From Grade" },
    { key: "toGrade", label: "To Grade" },
    { key: "effectiveDate", label: "Effective Date" },
    { key: "orderNo", label: "Order No." },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Promotions" subtitle="Promotion orders with grade progression details." back="/hr" />
      <StatGrid>
        <StatCard icon="⬆️" iconBg="#e6f7f0" label="Total Promotions" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f0ff" label="Approved" value={approved} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="📋" iconBg="#f5f5f5" label="Completed" value={completed} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Promotion Orders</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee, department or grade…" pageSize={15} />
      </div>
    </main>
  );
}
