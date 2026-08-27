import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";

/**
 * ShiftRequestsPage — employee requests to swap/change shift.
 * Maker-checker: employee submits → supervisor approves.
 * GoI context: shift changes must be approved per DoPT staffing guidelines.
 *
 * Canonical route for shift change requests (linked from the HR hub). A
 * duplicate previously lived at /hr/shifts/requests (linked from the Shifts
 * page) with a slightly different, more accurate field mapping -- consolidated
 * here; see HR-A deep-verify notes.
 */

type Row = {
  id: string;
  employeeId: string;
  employeeName: string;
  currentShift: string;
  requestedShift: string;
  effectiveDate: string;
  reason: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  // Real shape from GET /v1/hrms/shift-requests: { id, employeeId, employeeName,
  // currentShift, requestedShift, effectiveDate, reason, status, createdAt }.
  // There is no `department` field -- a column for it previously rendered blank
  // on every row.
  return fetchJson<unknown, Row[]>("/api/v1/hrms/shift-requests", [], {
    telemetryKey: "hr.shift-requests",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      if (!Array.isArray(arr)) return null;
      return arr.map((r) => ({
        ...r,
        employeeName: (r as Record<string, unknown>).employeeName as string ?? r.employeeId,
        reason: r.reason ?? "—",
      }));
    },
  });
}

const COLUMNS: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
  { key: "employeeName", label: "Employee" },
  { key: "currentShift", label: "Current Shift" },
  { key: "requestedShift", label: "Requested Shift" },
  { key: "effectiveDate", label: "Effective Date" },
  { key: "reason", label: "Reason" },
  { key: "status", label: "Status", cellType: "status" },
];

export default async function ShiftRequestsPage() {
  const { data: items, source } = await getData();

  const pending = items.filter((i) => i.status === "pending").length;
  const approved = items.filter((i) => i.status === "approved").length;
  const rejected = items.filter((i) => ["rejected", "declined"].includes(i.status)).length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Shift Change Requests"
        subtitle="Employees requesting a swap or change of assigned shift. Supervisor approval required."
        back="/hr"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🔄" iconBg="#e6f0ff" label="Total Requests" value={items.length} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending Approval" value={pending} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Approved" value={approved} />
        <StatCard icon="❌" iconBg="#fff0f0" label="Rejected" value={rejected} />
      </StatGrid>
      <Card title="Shift Change Requests">
        <DataTable<Row>
          columns={COLUMNS}
          rows={items}
          sortable
          filterable
          filterPlaceholder="Filter by employee, shift or status…"
          pageSize={20}
          emptyIcon="🔄"
          emptyTitle="No shift change requests"
          emptyMessage="Requests appear here once employees apply to change their assigned shift. Approved by the reporting officer per DoPT staffing policy."
        />
      </Card>
    </main>
  );
}
