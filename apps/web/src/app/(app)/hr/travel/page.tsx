import { PageHeader, StatGrid, StatCard, DataTable } from "../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";

type Row = {
  id: string;
  purpose: string;
  destination: string;
  from_date: string;
  to_date: string;
  advance_required: number;
  mode: string;
  status: string;
  created_at: string;
} & Record<string, unknown>;

async function getData(): Promise<Row[]> {
  const r = await fetchJson<unknown, Row[]>("/api/v1/hrms/travel-requests", [], {
    telemetryKey: "hr.travel",
    mapResponse: (p) => {
      const arr = (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
  return r.data;
}

export default async function TravelRequestsPage() {
  const items = await getData();

  const pending = items.filter((i) => i.status === "pending").length;
  const approved = items.filter((i) => i.status === "approved").length;
  const rejected = items.filter((i) => i.status === "rejected").length;

  const columns: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
    { key: "destination", label: "Destination" },
    { key: "purpose", label: "Purpose" },
    { key: "from_date", label: "From" },
    { key: "to_date", label: "To" },
    { key: "mode", label: "Mode" },
    { key: "status", label: "Status", cellType: "status" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Travel Requests"
        subtitle="Submit and track official travel approvals"
      />

      <StatGrid>
        <StatCard icon="✈️" iconBg="#e6f0ff" label="Total Requests" value={items.length} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Approved" value={approved} />
        <StatCard icon="❌" iconBg="#fef2f2" label="Rejected" value={rejected} />
      </StatGrid>

      <DataTable columns={columns} rows={items} exportable />
    </div>
  );
}
