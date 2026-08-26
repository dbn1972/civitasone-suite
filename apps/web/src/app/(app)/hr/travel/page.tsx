import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { TravelRequestForm } from "./TravelRequestForm";

type Row = {
  id: string;
  purpose: string;
  destination: string;
  from_date: string;
  to_date: string;
  mode: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/travel-requests", [], {
    telemetryKey: "hr.travel",
    mapResponse: (p) => {
      const arr = (p as { data?: Row[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function TravelRequestsPage() {
  const { data: items, source } = await getData();

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
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Travel Requests"
        subtitle="Submit and track official travel approvals — LTC, tour advance, and TA/DA settlement."
        back="/hr"
        actions={<span />}
      />
      <DataSourceBadge source={source} message="Couldn't load — showing nothing" />
      <StatGrid>
        <StatCard icon="✈️" iconBg="#e6f0ff" label="Total Requests" value={items.length} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending Approval" value={pending} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Approved" value={approved} />
        <StatCard icon="❌" iconBg="#fef2f2" label="Rejected" value={rejected} />
      </StatGrid>
      <TravelRequestForm />
      <div style={{ marginTop: 16 }}>
        <Card title="Travel Requests">
          <DataTable<Row>
            columns={columns}
            rows={items}
            sortable
            filterable
            filterPlaceholder="Filter by destination or purpose…"
            pageSize={15}
            emptyIcon="✈️"
            emptyTitle="No travel requests"
            emptyMessage="Official travel requests submitted via the form above appear here for tracking and approval. Requests are reviewed by the reporting manager before booking."
          />
        </Card>
      </div>
    </main>
  );
}
