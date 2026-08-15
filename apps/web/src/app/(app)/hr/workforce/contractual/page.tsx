import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { ContractorRow } from "../../_components/ContractorRow";

/**
 * ContractualPage — contract employees table with renewal tracking.
 * GFR 2017 Chapter 8: contractor management compliance.
 */

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

async function getContractual(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/employees?limit=200", [], {
    telemetryKey: "hr.workforce.contractual",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: ApiEmployee[] })?.data;
      return Array.isArray(arr) ? mapContractual(arr as ApiEmployee[]) : null;
    },
  });
}

export default async function ContractualPage() {
  const { data: items, source } = await getContractual();

  const active = items.filter((i) => i.status === "active").length;
  const expiring = items.filter((i) => {
    const parts = i.contractTo.split("/");
    if (parts.length === 3) {
      const [dd, mm, yyyy] = parts;
      const end = new Date(`${yyyy}-${mm}-${dd}`);
      const days = Math.ceil((end.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      return days >= 0 && days <= 30;
    }
    return false;
  }).length;
  const agencies = new Set(items.map((i) => i.agency).filter((a) => a !== "—")).size;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Contractual Employees"
        subtitle="GFR 2017 Ch. 8 — contractor management, contract periods, and renewal alerts."
        back="/hr/workforce"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="📋" iconBg="#e6f0ff" label="Total Contractual" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Active" value={active} />
        <StatCard icon="⚠️" iconBg="#fffbe6" label="Expiring ≤30d" value={expiring} />
        <StatCard icon="🏢" iconBg="#f5f5f5" label="Agencies" value={agencies} />
      </StatGrid>

      <Card title="Contractual Staff">
        {items.length > 0 ? (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }} aria-label="Contractual staff list">
              <thead>
                <tr style={{ background: "var(--surface-2, #f9fafb)", textAlign: "left" }}>
                  {["Name", "Agency", "Department", "Designation", "From", "To", "Status"].map((h) => (
                    <th key={h} scope="col" style={{ padding: "10px 12px", fontSize: 12, fontWeight: 600, color: "var(--muted, #6b7280)", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <ContractorRow key={row.id} {...row} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <DataTable<Row>
            columns={[
              { key: "name", label: "Name" },
              { key: "agency", label: "Agency" },
              { key: "department", label: "Department" },
              { key: "designation", label: "Designation" },
              { key: "contractFrom", label: "From" },
              { key: "contractTo", label: "To" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={items}
            sortable
            filterable
            filterPlaceholder="Filter by name, agency or department…"
            pageSize={15}
            emptyIcon="📑"
            emptyTitle="No contractual staff"
            emptyMessage="Contractual staff appear here once engaged. GFR 2017 Chapter 8 mandates tracking contract periods and renewal dates."
          />
        )}
      </Card>
    </main>
  );
}
