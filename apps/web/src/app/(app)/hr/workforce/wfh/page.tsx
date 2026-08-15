import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../../_components/ds";
import { DataSourceBadge } from "../../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { WFHRequestForm } from "../../_components/WFHRequestForm";

/**
 * WFHPage — Work From Home requests and approvals.
 * DoPT WFH policy: max 2 days/week for eligible cadres.
 * Status chips: Pending / Approved / Rejected / Recalled.
 */

type Row = {
  id: string;
  employeeName: string;
  department: string;
  fromDate: string;
  toDate: string;
  days: string;
  reason: string;
  status: string;
} & Record<string, unknown>;

async function getData(): Promise<LoaderResult<Row[]>> {
  return fetchJson<unknown, Row[]>("/api/v1/hrms/wfh-requests", [], {
    telemetryKey: "hr.workforce.wfh",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: Row[] })?.data;
      if (!Array.isArray(arr)) return null;
      return arr.map((r) => ({
        ...r,
        employeeName: (r as Record<string, unknown>).employeeName as string ?? r.employeeId,
        department: r.department ?? "—",
        days: r.days ?? "—",
        reason: r.reason ?? "—",
      }));
    },
  });
}

const COLUMNS: { key: keyof Row & string; label: string; cellType?: "status" }[] = [
  { key: "employeeName", label: "Employee" },
  { key: "department", label: "Department" },
  { key: "fromDate", label: "From" },
  { key: "toDate", label: "To" },
  { key: "days", label: "Days" },
  { key: "reason", label: "Reason" },
  { key: "status", label: "Status", cellType: "status" },
];

export default async function WFHPage() {
  const { data: items, source } = await getData();

  const approved = items.filter((i) => i.status === "approved").length;
  const pending = items.filter((i) => i.status === "pending").length;
  const rejected = items.filter((i) => ["rejected", "declined"].includes(i.status)).length;
  const recalled = items.filter((i) => i.status === "recalled").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Work From Home"
        subtitle="Submit and track WFH requests. DoPT policy: eligible cadres may WFH up to 2 days/week."
        back="/hr/workforce"
      />
      <DataSourceBadge source={source} />
      <StatGrid>
        <StatCard icon="🏠" iconBg="#e6f0ff" label="Total Requests" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Approved" value={approved} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending" value={pending} />
        <StatCard icon="↩️" iconBg="#fff0f0" label="Rejected / Recalled" value={rejected + recalled} />
      </StatGrid>

      <Card title="New WFH Request">
        <WFHRequestForm />
      </Card>

      <div style={{ marginTop: 16 }}>
        <Card title="WFH Requests">
          <DataTable<Row>
            columns={COLUMNS}
            rows={items}
            sortable
            filterable
            filterPlaceholder="Filter by employee, department or status…"
            pageSize={15}
            emptyIcon="🏠"
            emptyTitle="No WFH requests"
            emptyMessage="Work-from-home requests appear here once employees raise them. Approved by the reporting officer per DoPT WFH guidelines."
          />
        </Card>
      </div>
    </main>
  );
}
