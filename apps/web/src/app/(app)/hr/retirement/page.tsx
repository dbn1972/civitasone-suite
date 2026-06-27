import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";

type Row = {
  id: string;
  employee: string;
  department: string;
  designation: string;
  dob: string;
  superannuationDate: string;
  separationType: string;
  status: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", employee: "R.K. Mehta", department: "Finance", designation: "Director", dob: "15/08/1964", superannuationDate: "31/08/2024", separationType: "Superannuation", status: "pending" },
  { id: "2", employee: "S.N. Prasad", department: "Admin", designation: "Under Secretary", dob: "22/09/1964", superannuationDate: "30/09/2024", separationType: "Superannuation", status: "pending" },
  { id: "3", employee: "K.L. Sharma", department: "Accounts", designation: "Sr. Accounts Officer", dob: "10/10/1964", superannuationDate: "31/10/2024", separationType: "Superannuation", status: "pending" },
  { id: "4", employee: "M. Venkatesh", department: "IT", designation: "Joint Director", dob: "05/12/1964", superannuationDate: "31/12/2024", separationType: "Superannuation", status: "pending" },
  { id: "5", employee: "P.S. Rawat", department: "Legal", designation: "Law Officer", dob: "18/03/1964", superannuationDate: "31/03/2024", separationType: "Superannuation", status: "completed" },
  { id: "6", employee: "A.K. Joshi", department: "Procurement", designation: "Deputy Director", dob: "28/06/1964", superannuationDate: "30/06/2024", separationType: "VRS", status: "completed" },
];

export default function RetirementPage() {
  const upcoming = items.filter((i) => i.status === "pending").length;
  const completed = items.filter((i) => i.status === "completed").length;
  const vrs = items.filter((i) => i.separationType === "VRS").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "designation", label: "Designation" },
    { key: "superannuationDate", label: "Superannuation Date" },
    { key: "separationType", label: "Type" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Retirement & Separation" subtitle="Upcoming retirements and separation queue." back="/hr" />
      <StatGrid>
        <StatCard icon="👴" iconBg="#e6f0ff" label="Total" value={items.length} />
        <StatCard icon="📅" iconBg="#fffbe6" label="Upcoming" value={upcoming} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Processed" value={completed} />
        <StatCard icon="📝" iconBg="#f5f5f5" label="VRS" value={vrs} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Retirement Queue</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee, department or date…" pageSize={15} />
      </div>
    </main>
  );
}
