import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";

type Row = {
  id: string;
  name: string;
  department: string;
  agency: string;
  designation: string;
  contractFrom: string;
  contractTo: string;
  status: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", name: "Sunil Yadav", department: "IT", agency: "TCS iON", designation: "Software Developer", contractFrom: "01/04/2024", contractTo: "31/03/2025", status: "active" },
  { id: "2", name: "Ritu Mishra", department: "Admin", agency: "Manpower Group", designation: "Data Entry Operator", contractFrom: "01/01/2024", contractTo: "31/12/2024", status: "active" },
  { id: "3", name: "Mohd Irfan", department: "IT", agency: "Wipro", designation: "Network Engineer", contractFrom: "15/02/2024", contractTo: "14/02/2025", status: "active" },
  { id: "4", name: "Lakshmi S.", department: "HR", agency: "Randstad", designation: "HR Executive", contractFrom: "01/06/2024", contractTo: "30/11/2024", status: "active" },
  { id: "5", name: "Rohan Das", department: "Finance", agency: "KPMG", designation: "Accounts Assistant", contractFrom: "01/04/2023", contractTo: "31/03/2024", status: "completed" },
  { id: "6", name: "Farhan Sheikh", department: "Procurement", agency: "Manpower Group", designation: "Procurement Asst.", contractFrom: "01/07/2024", contractTo: "30/06/2025", status: "active" },
];

export default function ContractualPage() {
  const active = items.filter((i) => i.status === "active").length;
  const completed = items.filter((i) => i.status === "completed").length;
  const agencies = new Set(items.map((i) => i.agency)).size;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "name", label: "Name" },
    { key: "department", label: "Department" },
    { key: "agency", label: "Agency" },
    { key: "designation", label: "Designation" },
    { key: "contractFrom", label: "From" },
    { key: "contractTo", label: "To" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Contractual Employees" subtitle="Contractual staff engagement details and contract periods." back="/hr" />
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total Contractual" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Active" value={active} />
        <StatCard icon="📁" iconBg="#fffbe6" label="Expired" value={completed} />
        <StatCard icon="🏢" iconBg="#f5f5f5" label="Agencies" value={agencies} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Contractual Staff</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by name, agency or department…" pageSize={15} />
      </div>
    </main>
  );
}
