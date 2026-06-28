import { PageHeader, Card, DataTable, EmptyState } from "../../../_components/ds";
import { fetchJson } from "@/app/_data/apiClient";

type Designation = { id: string; code: string; name: string; level: number; payGrade: string | null } & Record<string, unknown>;

async function getDesignations(): Promise<Designation[]> {
  const r = await fetchJson<unknown, Designation[]>("/api/v1/hrms/designations", [], {
    telemetryKey: "config.designations",
    mapResponse: (p) => (p as { data: Designation[] })?.data ?? null,
  });
  return r.data;
}

export default async function DesignationsPage() {
  const items = await getDesignations();

  return (
    <main className="page-main" aria-labelledby="page-heading">
      <PageHeader
        title="Designations"
        subtitle="Job titles and pay levels used across your office — Clerk, Officer, DDO, etc."
        back="/hr"
        backLabel="HR"
        help="hr"
      />

      <Card title={`Designations (${items.length})`}>
        {items.length === 0 ? (
          <EmptyState
            icon="🏷️"
            title="No designations yet"
            message="Add your first designation so employees can be given a proper job title."
          />
        ) : (
          <DataTable<Designation>
            columns={[
              { key: "code", label: "Code" },
              { key: "name", label: "Designation" },
              { key: "level", label: "Pay Level", align: "right" },
              { key: "payGrade", label: "Pay Grade" },
            ]}
            rows={items}
            sortable
            filterable
            filterPlaceholder="Search designations…"
          />
        )}
      </Card>
    </main>
  );
}
