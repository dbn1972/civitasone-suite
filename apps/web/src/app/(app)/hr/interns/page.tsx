import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";

type ApiEmployee = {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  institution?: string;
  department?: string;
  periodFrom?: string;
  periodTo?: string;
  mentor?: string;
  employmentType?: string;
  type?: string;
  status: string;
};

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

function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function mapInterns(apiItems: ApiEmployee[]): Row[] {
  return apiItems
    .filter((e) => {
      const t = (e.employmentType ?? e.type ?? "").toLowerCase();
      return t === "intern" || t === "apprentice" || t === "internship" || t === "apprenticeship";
    })
    .map((e) => ({
      id: e.id,
      name: e.name ?? ([e.firstName, e.lastName].filter(Boolean).join(" ") || e.id),
      institution: e.institution ?? "—",
      department: e.department ?? "—",
      periodFrom: formatDate(e.periodFrom),
      periodTo: formatDate(e.periodTo),
      mentor: e.mentor ?? "—",
      type: (e.employmentType ?? e.type ?? "Intern").replace(/^./, (c) => c.toUpperCase()),
      status: e.status,
    }));
}

async function getInterns(): Promise<Row[]> {
  const res = await fetchJson<unknown, Row[]>("/api/v1/hrms/employees?limit=50", [], {
    telemetryKey: "hr.interns",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiEmployee[] })?.data;
      return Array.isArray(arr) ? mapInterns(arr as ApiEmployee[]) : null;
    },
  });
  return res.data;
}

export default async function InternsPage() {
  const items = await getInterns();

  const active = items.filter((i) => i.status === "active").length;
  const interns = items.filter((i) => i.type.toLowerCase() === "intern" || i.type.toLowerCase() === "internship").length;
  const apprentices = items.filter((i) => i.type.toLowerCase() === "apprentice" || i.type.toLowerCase() === "apprenticeship").length;

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
