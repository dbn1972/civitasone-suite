import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";

type Row = {
  id: string;
  employee: string;
  department: string;
  destination: string;
  fromDate: string;
  toDate: string;
  amount: string;
  claimType: string;
  status: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", employee: "Rajesh Verma", department: "Finance", destination: "Mumbai", fromDate: "10/07/2024", toDate: "13/07/2024", amount: "₹18,500", claimType: "TA/DA", status: "approved" },
  { id: "2", employee: "Priya Sharma", department: "HR", destination: "Bangalore", fromDate: "15/07/2024", toDate: "17/07/2024", amount: "₹12,000", claimType: "TA/DA", status: "pending" },
  { id: "3", employee: "Amit Patel", department: "IT", destination: "Hyderabad", fromDate: "20/07/2024", toDate: "22/07/2024", amount: "₹15,800", claimType: "LTC", status: "pending" },
  { id: "4", employee: "Sunita Rao", department: "Legal", destination: "Chennai", fromDate: "01/07/2024", toDate: "03/07/2024", amount: "₹9,200", claimType: "TA/DA", status: "approved" },
  { id: "5", employee: "Vikram Singh", department: "Admin", destination: "Jaipur", fromDate: "05/06/2024", toDate: "06/06/2024", amount: "₹5,500", claimType: "TA/DA", status: "completed" },
  { id: "6", employee: "Deepak Kumar", department: "IT", destination: "Pune", fromDate: "25/07/2024", toDate: "28/07/2024", amount: "₹22,000", claimType: "TA/DA", status: "pending" },
  { id: "7", employee: "Meera Iyer", department: "Accounts", destination: "Delhi", fromDate: "08/07/2024", toDate: "10/07/2024", amount: "₹14,500", claimType: "TA/DA", status: "approved" },
];

export default function TravelPage() {
  const approved = items.filter((i) => i.status === "approved").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const totalAmount = "₹97,500";

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "destination", label: "Destination" },
    { key: "fromDate", label: "From" },
    { key: "toDate", label: "To" },
    { key: "amount", label: "Amount" },
    { key: "claimType", label: "Type" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Travel & TA/DA Claims" subtitle="Travel requests and Travelling Allowance / Daily Allowance claims." back="/hr" />
      <StatGrid>
        <StatCard icon="✈️" iconBg="#e6f0ff" label="Total Requests" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Approved" value={approved} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="💰" iconBg="#f5f5f5" label="Total Claims" value={totalAmount} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Travel Claims</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee, destination or type…" pageSize={15} />
      </div>
    </main>
  );
}
