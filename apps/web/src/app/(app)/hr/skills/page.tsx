import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";

type Row = {
  id: string;
  employee: string;
  department: string;
  skill: string;
  category: string;
  proficiency: string;
  assessedBy: string;
  lastAssessed: string;
} & Record<string, unknown>;

const items: Row[] = [
  { id: "1", employee: "Amit Patel", department: "IT", skill: "Cloud Computing (AWS)", category: "Technical", proficiency: "Expert", assessedBy: "Deepak Kumar", lastAssessed: "15/06/2024" },
  { id: "2", employee: "Deepak Kumar", department: "IT", skill: "Cybersecurity", category: "Technical", proficiency: "Advanced", assessedBy: "External Assessor", lastAssessed: "01/05/2024" },
  { id: "3", employee: "Rajesh Verma", department: "Finance", skill: "Financial Analysis", category: "Domain", proficiency: "Expert", assessedBy: "HOD Finance", lastAssessed: "20/04/2024" },
  { id: "4", employee: "Priya Sharma", department: "HR", skill: "Talent Management", category: "Domain", proficiency: "Advanced", assessedBy: "Director HR", lastAssessed: "10/05/2024" },
  { id: "5", employee: "Sunita Rao", department: "Legal", skill: "Contract Drafting", category: "Domain", proficiency: "Expert", assessedBy: "Law Secretary", lastAssessed: "25/03/2024" },
  { id: "6", employee: "Vikram Singh", department: "Admin", skill: "Project Management", category: "Management", proficiency: "Intermediate", assessedBy: "HOD Admin", lastAssessed: "12/06/2024" },
  { id: "7", employee: "Meera Iyer", department: "Accounts", skill: "ERP (SAP FICO)", category: "Technical", proficiency: "Advanced", assessedBy: "IT Head", lastAssessed: "08/04/2024" },
  { id: "8", employee: "Rahul Mehra", department: "IT", skill: "React/TypeScript", category: "Technical", proficiency: "Advanced", assessedBy: "Amit Patel", lastAssessed: "20/06/2024" },
];

export default function SkillsPage() {
  const expert = items.filter((i) => i.proficiency === "Expert").length;
  const advanced = items.filter((i) => i.proficiency === "Advanced").length;
  const intermediate = items.filter((i) => i.proficiency === "Intermediate").length;

  const columns: { key: keyof Row & string; label: string }[] = [
    { key: "employee", label: "Employee" },
    { key: "department", label: "Department" },
    { key: "skill", label: "Skill" },
    { key: "category", label: "Category" },
    { key: "proficiency", label: "Proficiency" },
    { key: "assessedBy", label: "Assessed By" },
    { key: "lastAssessed", label: "Last Assessed" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Skill Matrix" subtitle="Employee skill mapping and proficiency assessment." back="/hr" />
      <StatGrid>
        <StatCard icon="🧠" iconBg="#e6f0ff" label="Total Entries" value={items.length} />
        <StatCard icon="🏆" iconBg="#e6f7f0" label="Expert" value={expert} />
        <StatCard icon="📈" iconBg="#fffbe6" label="Advanced" value={advanced} />
        <StatCard icon="📋" iconBg="#f5f5f5" label="Intermediate" value={intermediate} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Skill Matrix</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee, skill or proficiency…" pageSize={15} />
      </div>
    </main>
  );
}
