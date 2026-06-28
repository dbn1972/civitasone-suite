import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";

type ApiEmployee = {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  department?: string;
  agency?: string;
  designation?: string;
  contractFrom?: string;
  contractTo?: string;
  employmentType?: string;
  type?: string;
  status: string;
};

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

function mapContractual(apiItems: ApiEmployee[]): Row[] {
  return apiItems
    .filter((e) => {
      const t = (e.employmentType ?? e.type ?? "").toLowerCase();
      return t === "contract" || t === "contractual";
    })
    .map((e) => ({
      id: e.id,
      name: e.name ?? ([e.firstName, e.lastName].filter(Boolean).join(" ") || e.id),
      department: e.department ?? "—",
      agency: e.agency ?? "—",
      designation: e.designation ?? "—",
      contractFrom: formatDate(e.contractFrom),
      contractTo: formatDate(e.contractTo),
      status: e.status,
    }));
}

async function getContractual(): Promise<Row[]> {
  const res = await fetchJson<unknown, Row[]>("/api/v1/hrms/employees?limit=50", [], {
    telemetryKey: "hr.contractual",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiEmployee[] })?.data;
      return Array.isArray(arr) ? mapContractual(arr as ApiEmployee[]) : null;
    },
  });
  return res.data;
}

export default async function ContractualPage() {
  const items = await getContractual();

  const active = items.filter((i) => i.status === "active").length;
  const completed = items.filter((i) => i.status === "completed" || i.status === "expired").length;
  const agencies = new Set(items.map((i) => i.agency).filter((a) => a !== "—")).size;

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
