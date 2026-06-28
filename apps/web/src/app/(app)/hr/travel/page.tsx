import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";

type Row = {
  id: string;
  employee: string;
  department: string;
  destination: string;
  fromDate: string;
  toDate: string;
  amount: string;
  claimType: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<Row[]> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/travel-requests", [], {
    telemetryKey: "hr.travel",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r.data;
}

export default async function TravelPage() {
  const items = await getData();

  const approved = items.filter((i) => i.status === "approved").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const totalAmount = items.length > 0 ? `${items.length} claims` : "—";

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "employee", label: "Employee" },
    { key: "destination", label: "Destination" },
    { key: "fromDate", label: "From" },
    { key: "toDate", label: "To" },
    { key: "amount", label: "Amount" },
    { key: "claimType", label: "Type" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader title="Travel & TA/DA Claims" subtitle="Travel requests and Travelling Allowance / Daily Allowance claims." back="/hr" />
      <StatGrid>
        <StatCard icon="✈️" iconBg="#e6f0ff" label="Total Requests" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Approved" value={approved} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="💰" iconBg="#f5f5f5" label="Total Claims" value={totalAmount} />
      </StatGrid>
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-h"><h3>Travel Claims</h3></div>
        <DataTable<Row> columns={columns} rows={items} sortable filterable filterPlaceholder="Filter by employee, destination or type…" pageSize={15} />
      </div>
    </main>
  );
}
