import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";

type ApiElection = {
  id: string;
  plan_name: string;
  fy: string;
  elections: Array<{ component: string; electedMinor: number }>;
  total_elected_minor: number;
  status: string;
};

type Row = {
  id: string;
  plan_name: string;
  fy: string;
  total_elected: string;
  components: string;
  status: string;
} & Record<string, unknown>;

function formatINR(minor: number): string {
  if (minor == null) return "—";
  return `₹${(minor / 100).toLocaleString("en-IN")}`;
}

function mapElections(rows: ApiElection[]): Row[] {
  return rows.map((e) => ({
    id: e.id,
    plan_name: e.plan_name ?? "—",
    fy: e.fy ?? "—",
    total_elected: formatINR(e.total_elected_minor),
    components: Array.isArray(e.elections)
      ? e.elections.map((c) => c.component).join(", ")
      : "—",
    status: e.status ?? "active",
  }));
}

async function getData(): Promise<Row[]> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/benefits/my-elections", [], {
    telemetryKey: "hr.benefits",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiElection[] })?.data;
      return Array.isArray(arr) ? mapElections(arr as ApiElection[]) : null;
    },
  });
  return r.data;
}

export default async function BenefitsPage() {
  const items = await getData();

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "plan_name", label: "Plan" },
    { key: "fy", label: "Financial Year" },
    { key: "components", label: "Components" },
    { key: "total_elected", label: "Total Elected" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Benefits Enrollment" subtitle="HRA, LTC, medical, and flex-benefit elections for the financial year." back="/hr" />
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Active Elections" value={items.length} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>My Benefit Elections</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by plan or FY…" pageSize={15} />
      </div>
    </main>
  );
}
