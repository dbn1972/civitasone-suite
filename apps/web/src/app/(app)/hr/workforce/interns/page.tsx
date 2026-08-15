import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

/**
 * InternsPage — intern cohort list with institution, stipend, project, and end date.
 * MHRD apprenticeship guidelines and GoI internship scheme compliance.
 */

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
  projectAssigned?: string;
  project?: string;
  stipend?: string | number;
  employmentType?: string;
  type?: string;
  status: string;
};

type Row = {
  id: string;
  name: string;
  institution: string;
  department: string;
  projectAssigned: string;
  stipend: string;
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
      projectAssigned: e.projectAssigned ?? e.project ?? "—",
      stipend: e.stipend ? `₹${Number(e.stipend).toLocaleString("en-IN")}` : "—",
      periodFrom: formatDate(e.periodFrom),
      periodTo: formatDate(e.periodTo),
      mentor: e.mentor ?? "—",
      type: (e.employmentType ?? e.type ?? "Intern").replace(/^./, (c) => c.toUpperCase()),
      status: e.status,
    }));
}

async function getInterns(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/employees?limit=200", [], {
    telemetryKey: "hr.workforce.interns",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiEmployee[] })?.data;
      return Array.isArray(arr) ? mapInterns(arr as ApiEmployee[]) : null;
    },
  });
}

const COLUMNS: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
  { key: "name", label: "Name" },
  { key: "institution", label: "Institution" },
  { key: "department", label: "Department" },
  { key: "projectAssigned", label: "Project" },
  { key: "stipend", label: "Stipend" },
  { key: "periodFrom", label: "From" },
  { key: "periodTo", label: "End Date" },
  { key: "mentor", label: "Mentor" },
  { key: "type", label: "Type" },
  { key: "status", label: "Status", cellType: "status" },
];

export default async function InternsPage() {
  const { data: items, source } = await getInterns();

  const active = items.filter((i) => i.status === "active").length;
  const interns = items.filter((i) => ["intern", "internship"].includes(i.type.toLowerCase())).length;
  const apprentices = items.filter((i) => ["apprentice", "apprenticeship"].includes(i.type.toLowerCase())).length;
  const institutions = new Set(items.map((i) => i.institution).filter((v) => v !== "—")).size;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Interns & Apprentices"
        subtitle="Intern cohort management — institution, stipend, project assignment, and end date tracking."
        back="/hr/workforce"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🎓" iconBg="#e6f0ff" label="Total" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Active" value={active} />
        <StatCard icon="📚" iconBg="#fffbe6" label="Interns" value={interns} />
        <StatCard icon="🔧" iconBg="#f5f5f5" label="Apprentices" value={apprentices} />
      </StatGrid>
      <Card title="Intern Cohort">
        <DataTable<Row>
          columns={COLUMNS}
          rows={items}
          sortable
          filterable
          filterPlaceholder="Filter by name, institution or mentor…"
          pageSize={15}
          emptyIcon="🎓"
          emptyTitle="No interns or apprentices"
          emptyMessage="Intern and apprenticeship engagements appear here with stipend, assigned project, mentor, and duration details."
        />
      </Card>
    </main>
  );
}
