import Link from "next/link";
import { PageHeader, Card, DataTable, EmptyState } from "../../../_components/ds";
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

const COLUMNS = [
  { key: "employeeId" as const,     label: "Employee" },
  { key: "requestDate" as const,    label: "Date" },
  { key: "hoursRequested" as const, label: "Hours" },
  { key: "reason" as const,         label: "Reason" },
  { key: "status" as const,         label: "Status", cellType: "status" as const },
];

export default async function OvertimePage() {
  const result = await getOvertimeRequests();
  const requests = result.data;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Overtime Requests"
        subtitle="Review, approve, and track employee overtime requests."
        help="hr"
        actions={
          <Link href="/hr/overtime/new" className="btn primary">+ New Request</Link>
        }
      />
      {result.source === "error" && <DataSourceBadge source="error" />}

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
            filterPlaceholder="Filter by date, status…"
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
