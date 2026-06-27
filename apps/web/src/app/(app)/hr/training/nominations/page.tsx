import { PageHeader, StatGrid, StatCard, DataTable } from "../../../../_components/ds";

type Row = {
  id: string;
  employee: string;
  department: string;
  program: string;
  nominatedBy: string;
  nominationDate: string;
  programDate: string;
  status: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", employee: "Rahul Mehra", department: "IT", program: "Cloud Architecture Workshop", nominatedBy: "Amit Patel", nominationDate: "01/07/2024", programDate: "15/08/2024", status: "approved" },
  { id: "2", employee: "Sneha Kulkarni", department: "Finance", program: "PFMS Advanced Module", nominatedBy: "Rajesh Verma", nominationDate: "05/07/2024", programDate: "20/08/2024", status: "pending" },
  { id: "3", employee: "Arjun Nair", department: "HR", program: "Labour Law Updates 2024", nominatedBy: "Priya Sharma", nominationDate: "10/07/2024", programDate: "25/08/2024", status: "approved" },
  { id: "4", employee: "Divya Pillai", department: "Legal", program: "Arbitration & Mediation", nominatedBy: "Sunita Rao", nominationDate: "08/07/2024", programDate: "10/09/2024", status: "pending" },
  { id: "5", employee: "Karan Joshi", department: "Procurement", program: "GeM Portal Training", nominatedBy: "Self", nominationDate: "12/07/2024", programDate: "05/08/2024", status: "approved" },
  { id: "6", employee: "Pooja Saxena", department: "Admin", program: "eOffice Advanced", nominatedBy: "Vikram Singh", nominationDate: "15/07/2024", programDate: "01/09/2024", status: "rejected" },
  { id: "7", employee: "Nikhil Gupta", department: "Accounts", program: "GST Compliance", nominatedBy: "Meera Iyer", nominationDate: "18/07/2024", programDate: "12/08/2024", status: "pending" },
];

export default function TrainingNominationsPage() {
  const approved = items.filter((i) => i.status === "approved").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const rejected = items.filter((i) => i.status === "rejected").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "program", label: "Program" },
    { key: "nominatedBy", label: "Nominated By" },
    { key: "programDate", label: "Program Date" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Training Nominations" subtitle="Nominations for upcoming training programs." back="/hr" />
      <StatGrid>
        <StatCard icon="🎓" iconBg="#e6f0ff" label="Total Nominations" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Approved" value={approved} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="❌" iconBg="#fff0f0" label="Rejected" value={rejected} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Nominations</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee, program or status…" pageSize={15} />
      </div>
    </main>
  );
}
