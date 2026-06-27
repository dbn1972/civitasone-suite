import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";

type Row = {
  id: string;
  name: string;
  institution: string;
  department: string;
  periodFrom: string;
  periodTo: string;
  mentor: string;
  type: string;
  status: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", name: "Aditya Krishnan", institution: "IIT Delhi", department: "IT", periodFrom: "01/06/2024", periodTo: "31/08/2024", mentor: "Amit Patel", type: "Intern", status: "active" },
  { id: "2", name: "Shruti Pandey", institution: "IIFT Delhi", department: "Finance", periodFrom: "15/05/2024", periodTo: "15/08/2024", mentor: "Rajesh Verma", type: "Intern", status: "active" },
  { id: "3", name: "Mohd Zaid", institution: "Jamia Millia", department: "Legal", periodFrom: "01/07/2024", periodTo: "30/09/2024", mentor: "Sunita Rao", type: "Intern", status: "active" },
  { id: "4", name: "Tanvi Sharma", institution: "ITI Pusa", department: "IT", periodFrom: "01/04/2024", periodTo: "30/09/2024", mentor: "Deepak Kumar", type: "Apprentice", status: "active" },
  { id: "5", name: "Rajat Meena", institution: "Govt Polytechnic", department: "Admin", periodFrom: "01/04/2024", periodTo: "31/03/2025", mentor: "Vikram Singh", type: "Apprentice", status: "active" },
  { id: "6", name: "Neha Tiwari", institution: "Delhi University", department: "HR", periodFrom: "01/01/2024", periodTo: "31/03/2024", mentor: "Priya Sharma", type: "Intern", status: "completed" },
];

export default function InternsPage() {
  const active = items.filter((i) => i.status === "active").length;
  const interns = items.filter((i) => i.type === "Intern").length;
  const apprentices = items.filter((i) => i.type === "Apprentice").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "name", label: "Name" },
    { key: "institution", label: "Institution" },
    { key: "department", label: "Department" },
    { key: "periodFrom", label: "From" },
    { key: "periodTo", label: "To" },
    { key: "mentor", label: "Mentor" },
    { key: "type", label: "Type" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Interns & Apprentices" subtitle="Internship and apprenticeship engagements with mentor assignments." back="/hr" />
      <StatGrid>
        <StatCard icon="🎓" iconBg="#e6f0ff" label="Total" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Active" value={active} />
        <StatCard icon="📚" iconBg="#fffbe6" label="Interns" value={interns} />
        <StatCard icon="🔧" iconBg="#f5f5f5" label="Apprentices" value={apprentices} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Interns & Apprentices</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by name, institution or mentor…" pageSize={15} />
      </div>
    </main>
  );
}
