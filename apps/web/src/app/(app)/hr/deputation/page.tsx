import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";

type Row = {
  id: string;
  employee: string;
  parentOrg: string;
  deputationOrg: string;
  fromDate: string;
  toDate: string;
  period: string;
  status: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", employee: "Amit Patel", parentOrg: "MeitY", deputationOrg: "NIC, Delhi", fromDate: "10/01/2024", toDate: "09/01/2026", period: "2 years", status: "active" },
  { id: "2", employee: "Rekha Gupta", parentOrg: "DoT", deputationOrg: "TRAI, Noida", fromDate: "01/06/2023", toDate: "31/05/2025", period: "2 years", status: "active" },
  { id: "3", employee: "Manoj Tiwari", parentOrg: "MoF", deputationOrg: "NITI Aayog", fromDate: "15/04/2022", toDate: "14/04/2024", period: "2 years", status: "completed" },
  { id: "4", employee: "Neha Kapoor", parentOrg: "MoD", deputationOrg: "DRDO, Hyderabad", fromDate: "01/08/2024", toDate: "31/07/2026", period: "2 years", status: "pending" },
  { id: "5", employee: "Suresh Reddy", parentOrg: "MHA", deputationOrg: "NDMA, Delhi", fromDate: "20/03/2023", toDate: "19/03/2025", period: "2 years", status: "active" },
  { id: "6", employee: "Anita Deshmukh", parentOrg: "MoHFW", deputationOrg: "AIIMS, Delhi", fromDate: "01/09/2024", toDate: "31/08/2026", period: "2 years", status: "pending" },
];

export default function DeputationPage() {
  const active = items.filter((i) => i.status === "active").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const completed = items.filter((i) => i.status === "completed").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "parentOrg", label: "Parent Org" },
    { key: "deputationOrg", label: "Deputation To" },
    { key: "fromDate", label: "From" },
    { key: "toDate", label: "To" },
    { key: "period", label: "Period" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Deputation" subtitle="Officers on deputation to other organisations." back="/hr" />
      <StatGrid>
        <StatCard icon="🏛️" iconBg="#e6f0ff" label="Total Deputations" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Active" value={active} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="📋" iconBg="#f5f5f5" label="Completed" value={completed} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Deputation List</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee or organisation…" pageSize={15} />
      </div>
    </main>
  );
}
