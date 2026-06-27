import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";

type Row = {
  id: string;
  employee: string;
  fromOffice: string;
  toOffice: string;
  transferDate: string;
  orderNo: string;
  relievingDate: string;
  status: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", employee: "Rajesh Verma", fromOffice: "Finance, Delhi", toOffice: "Accounts, Lucknow", transferDate: "15/03/2024", orderNo: "TR/2024/0341", relievingDate: "30/03/2024", status: "completed" },
  { id: "2", employee: "Sunita Rao", fromOffice: "Legal, Hyderabad", toOffice: "Legal, Chennai", transferDate: "01/04/2024", orderNo: "TR/2024/0398", relievingDate: "—", status: "pending" },
  { id: "3", employee: "Deepak Kumar", fromOffice: "IT, Bangalore", toOffice: "IT, Pune", transferDate: "10/05/2024", orderNo: "TR/2024/0415", relievingDate: "25/05/2024", status: "completed" },
  { id: "4", employee: "Anita Deshmukh", fromOffice: "Admin, Mumbai", toOffice: "Admin, Nagpur", transferDate: "20/06/2024", orderNo: "TR/2024/0467", relievingDate: "—", status: "pending" },
  { id: "5", employee: "Suresh Reddy", fromOffice: "Procurement, Chennai", toOffice: "Procurement, Kochi", transferDate: "05/02/2024", orderNo: "TR/2024/0189", relievingDate: "18/02/2024", status: "completed" },
  { id: "6", employee: "Kavita Nair", fromOffice: "HR, Delhi", toOffice: "HR, Kolkata", transferDate: "12/07/2024", orderNo: "TR/2024/0501", relievingDate: "—", status: "approved" },
];

export default function TransferPage() {
  const completed = items.filter((i) => i.status === "completed").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const approved = items.filter((i) => i.status === "approved").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "fromOffice", label: "From" },
    { key: "toOffice", label: "To" },
    { key: "transferDate", label: "Transfer Date" },
    { key: "orderNo", label: "Order No." },
    { key: "relievingDate", label: "Relieving Date" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Transfer Orders" subtitle="Employee transfer orders and relieving status." back="/hr" />
      <StatGrid>
        <StatCard icon="🔄" iconBg="#e6f0ff" label="Total Transfers" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Completed" value={completed} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="👍" iconBg="#f0f5ff" label="Approved" value={approved} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Transfer Orders</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee, office or order no…" pageSize={15} />
      </div>
    </main>
  );
}
