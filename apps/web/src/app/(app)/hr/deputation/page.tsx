import { PageHeader, StatGrid, StatCard, Card, DataTable } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import { DeputationCard, type DeputationRow } from "./_components/DeputationCard";

async function getData(): Promise<LoaderResult<DeputationRow[]>> {
  return fetchJson<unknown, DeputationRow[]>("/api/v1/hrms/deputation", [], {
    telemetryKey: "hr.deputation",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: DeputationRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

export default async function DeputationPage() {
  const { data: items, source } = await getData();

  const active    = items.filter((i) => i.status === "active").length;
  const pending   = items.filter((i) => i.status === "pending").length;
  const completed = items.filter((i) => i.status === "completed").length;
  const recalled  = items.filter((i) => i.status === "recalled").length;

  const tableColumns: { key: keyof DeputationRow & string; label: string; cellType?: "status" }[] = [
    { key: "employee",     label: "Employee"      },
    { key: "parentOrg",   label: "Parent Org"    },
    { key: "deputationOrg", label: "Deputed To"  },
    { key: "fromDate",    label: "From"           },
    { key: "toDate",      label: "To"             },
    { key: "period",      label: "Period"         },
    { key: "status",      label: "Status", cellType: "status" },
  ];

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Deputation"
        subtitle="Officers on deputation to other government organisations."
        back="/hr"
      />
      <DataSourceBadge source={source} />

      <StatGrid>
        <StatCard icon="🏛️" iconBg="#e6f0ff" label="Total Deputations" value={items.length} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Active"            value={active} />
        <StatCard icon="⏳" iconBg="#fffbe6" label="Pending"           value={pending} />
        <StatCard icon="📋" iconBg="#f5f5f5" label="Completed"         value={completed} />
        {recalled > 0 && (
          <StatCard icon="↩️" iconBg="#fee2e2" label="Recalled" value={recalled} />
        )}
      </StatGrid>

      {/* Card grid for active/pending */}
      {items.filter((i) => ["active", "pending"].includes(i.status)).length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--ink2)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 14px" }}>
            Active Deputations
          </h2>
          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))" }}>
            {items.filter((i) => ["active", "pending"].includes(i.status)).map((d) => (
              <DeputationCard key={d.id} deputation={d} />
            ))}
          </div>
        </div>
      )}

      {/* Full table */}
      <Card title="Deputation List">
        <DataTable<DeputationRow>
          columns={tableColumns}
          rows={items}
          sortable
          filterable
          filterPlaceholder="Filter by employee or organisation…"
          pageSize={15}
          emptyIcon="🏛️"
          emptyTitle="No deputation orders"
          emptyMessage="Deputation orders appear when an officer is posted to another organisation on temporary assignment."
        />
      </Card>
    </main>
  );
}
