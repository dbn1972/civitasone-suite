import Link from "next/link";
import { PageHeader, StatGrid, StatCard, Card, DataTable, EmptyState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

type OTRequest = {
  id: string;
  employeeId: string;
  requestDate: string;
  hoursRequested: string;
  reason: string | null;
  status: string;
  approvedBy: string | null;
  approvedAt: string | null;
} & Record<string, unknown>;

async function getOvertimeRequests(): Promise<LoaderResult<OTRequest[]>> {
  return fetchJson<unknown, OTRequest[]>("/api/v1/hrms/overtime-requests", [], {
    telemetryKey: "overtime.list",
    mapResponse: (p) => {
      const arr = (p as Record<string, unknown>)?.data;
      return Array.isArray(arr) ? (arr as OTRequest[]) : null;
    },
  });
}

const COLUMNS: { key: keyof OTRequest & string; label: string; cellType?: "status" }[] = [
  { key: "employeeId",     label: "Employee" },
  { key: "requestDate",    label: "Date" },
  { key: "hoursRequested", label: "Hours" },
  { key: "reason",         label: "Reason" },
  { key: "status",         label: "Status", cellType: "status" },
];

export default async function OvertimePage() {
  const result = await getOvertimeRequests();
  const requests = result.data;

  const pending = requests.filter((r) => r.status === "pending").length;
  const approved = requests.filter((r) => r.status === "approved").length;
  const totalHrs = requests.reduce((s, r) => s + (parseFloat(String(r.hoursRequested)) || 0), 0);

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Overtime Requests"
        subtitle="Review and track employee overtime requests — linked to payroll disbursement."
        back="/hr"
        actions={
          <Link href="/hr/overtime/new" className="btn primary">+ New Request</Link>
        }
      />
      <DataSourceBadge source={result.source} />
      <StatGrid>
        <StatCard icon="⏱️" iconBg="#e6f0ff" label="Total Requests" value={requests.length} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending Approval" value={pending} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Approved" value={approved} />
        <StatCard icon="🕐" iconBg="#f5f5f5" label="Total Hours" value={`${totalHrs.toFixed(1)} h`} />
      </StatGrid>
      <Card title="All Overtime Requests">
        {requests.length === 0 ? (
          <EmptyState
            icon="⏱️"
            title="No overtime requests yet"
            message="Overtime requests submitted by employees will appear here for approval."
            action={<Link href="/hr/overtime/new" className="btn primary">+ New Request</Link>}
          />
        ) : (
          <DataTable<OTRequest>
            columns={COLUMNS}
            rows={requests}
            sortable
            filterable
            filterPlaceholder="Filter by date, status or employee…"
            pageSize={20}
            emptyIcon="⏱️"
            emptyTitle="No matching requests"
            emptyMessage="Adjust your filter to find the overtime request you need."
          />
        )}
      </Card>
    </main>
  );
}
