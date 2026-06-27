import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";

type Row = {
  id: string;
  name: string;
  department: string;
  designation: string;
  grade: string;
  extension: string;
  email: string;
  location: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", name: "Rajesh Verma", department: "Finance", designation: "Director", grade: "Level 13", extension: "2401", email: "rajesh.verma@gov.in", location: "Room 301, North Block" },
  { id: "2", name: "Priya Sharma", department: "HR", designation: "Deputy Director", grade: "Level 11", extension: "2215", email: "priya.sharma@gov.in", location: "Room 204, HR Wing" },
  { id: "3", name: "Amit Patel", department: "IT", designation: "Joint Director", grade: "Level 12", extension: "3102", email: "amit.patel@gov.in", location: "Room 510, IT Block" },
  { id: "4", name: "Sunita Rao", department: "Legal", designation: "Law Officer", grade: "Level 10", extension: "1801", email: "sunita.rao@gov.in", location: "Room 108, Legal Wing" },
  { id: "5", name: "Vikram Singh", department: "Admin", designation: "Under Secretary", grade: "Level 11", extension: "1105", email: "vikram.singh@gov.in", location: "Room 102, Main Block" },
  { id: "6", name: "Deepak Kumar", department: "IT", designation: "Senior Developer", grade: "Level 8", extension: "3108", email: "deepak.kumar@gov.in", location: "Room 512, IT Block" },
  { id: "7", name: "Meera Iyer", department: "Accounts", designation: "Accounts Officer", grade: "Level 9", extension: "2508", email: "meera.iyer@gov.in", location: "Room 202, Accounts" },
  { id: "8", name: "Kavita Nair", department: "Procurement", designation: "Section Officer", grade: "Level 8", extension: "1402", email: "kavita.nair@gov.in", location: "Room 305, Procurement" },
];

export default function DirectoryPage() {
  const departments = new Set(items.map((i) => i.department)).size;

  const columns: { key: keyof Row & string; label: string }[] = [
    { key: "name", label: "Name" },
    { key: "department", label: "Department" },
    { key: "designation", label: "Designation" },
    { key: "grade", label: "Grade" },
    { key: "extension", label: "Ext." },
    { key: "email", label: "Email" },
    { key: "location", label: "Location" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Employee Directory" subtitle="Search employees by name, department, designation, or extension." back="/hr" />
      <StatGrid>
        <StatCard icon="👥" iconBg="#e6f0ff" label="Total Staff" value={items.length} />
        <StatCard icon="🏢" iconBg="#e6f7f0" label="Departments" value={departments} />
        <StatCard icon="📞" iconBg="#fffbe6" label="With Extension" value={items.length} />
        <StatCard icon="📧" iconBg="#f5f5f5" label="Email Listed" value={items.length} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Directory</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Search by name, department, designation or extension…" pageSize={15} />
      </div>
    </main>
  );
}
