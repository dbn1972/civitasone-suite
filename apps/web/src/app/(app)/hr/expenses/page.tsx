import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";

type Row = {
  id: string;
  employee: string;
  department: string;
  category: string;
  amount: string;
  claimDate: string;
  description: string;
  status: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", employee: "Rajesh Verma", department: "Finance", category: "Office Supplies", amount: "₹4,500", claimDate: "10/07/2024", description: "Printer cartridges and paper", status: "approved" },
  { id: "2", employee: "Priya Sharma", department: "HR", category: "Training", amount: "₹15,000", claimDate: "05/07/2024", description: "Workshop registration fee", status: "approved" },
  { id: "3", employee: "Amit Patel", department: "IT", category: "Equipment", amount: "₹32,000", claimDate: "12/07/2024", description: "External monitor and keyboard", status: "pending" },
  { id: "4", employee: "Sunita Rao", department: "Legal", category: "Travel", amount: "₹8,750", claimDate: "18/06/2024", description: "Court visit — auto and meals", status: "approved" },
  { id: "5", employee: "Vikram Singh", department: "Admin", category: "Maintenance", amount: "₹22,000", claimDate: "01/07/2024", description: "Office AC repair", status: "rejected" },
  { id: "6", employee: "Deepak Kumar", department: "IT", category: "Software", amount: "₹12,500", claimDate: "20/07/2024", description: "Annual license renewal", status: "pending" },
  { id: "7", employee: "Kavita Nair", department: "Procurement", category: "Travel", amount: "₹6,200", claimDate: "15/07/2024", description: "Vendor site visit", status: "pending" },
];

export default function ExpensesPage() {
  const approved = items.filter((i) => i.status === "approved").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const rejected = items.filter((i) => i.status === "rejected").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "category", label: "Category" },
    { key: "amount", label: "Amount" },
    { key: "description", label: "Description" },
    { key: "claimDate", label: "Claim Date" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Expense Claims" subtitle="Employee expense claims with approval tracking." back="/hr" />
      <StatGrid>
        <StatCard icon="🧾" iconBg="#e6f0ff" label="Total Claims" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Approved" value={approved} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="❌" iconBg="#fff0f0" label="Rejected" value={rejected} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Expense Claims</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee, category or status…" pageSize={15} />
      </div>
    </main>
  );
}
