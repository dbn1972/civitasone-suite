import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import { PageHeader, Card, DataTable } from "@/app/_components/ds";
import { getHrAuditLog } from "@/app/_data/loaders";

export const dynamic = "force-dynamic";

export default async function HrAuditLogPage() {
  const { data: events, source } = await getHrAuditLog();

  const rows = events.map((e) => ({
    id: e.id,
    action: e.action ?? e.eventType ?? "—",
    resourceType: e.resourceType ?? "—",
    resourceId: e.resourceId ?? "—",
    actor: e.actorName ?? e.actorId ?? "—",
    timestamp: e.timestamp ? new Date(e.timestamp).toLocaleString("en-IN") : "—",
  }));

  return (
    <>
      <PageHeader
        title="HR Audit Log"
        subtitle="All HR actions — leave approvals, payroll runs, employee edits, salary changes. Required by e-Governance guidelines."
        back="/hr"
      />
      {source === "error" && <DataSourceBadge source="error" />}
      <Card title="Recent HR Actions">
        <DataTable
          columns={[
            { key: "timestamp", label: "When" },
            { key: "action", label: "Action" },
            { key: "resourceType", label: "Resource" },
            { key: "resourceId", label: "Resource ID" },
            { key: "actor", label: "Performed By" },
          ]}
          rows={rows}
          sortable
          filterable
          filterPlaceholder="Search audit trail…"
          pageSize={20}
          exportable
          exportFilename="hr-audit-log"
          emptyIcon="📋"
          emptyTitle="No audit records"
          emptyMessage="HR actions will appear here once employees, leaves, or payroll are modified."
        />
      </Card>
    </>
  );
}
