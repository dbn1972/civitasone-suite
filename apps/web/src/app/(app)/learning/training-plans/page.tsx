import { PageHeader, DataTable, EmptyState, RefreshErrorState } from "@/app/_components/ds";
import { toHumanError } from "@/lib/messages";
import { getTrainingPlans } from "../_data";

type Row = { id: string; title: string; planYear: string; scope: string; status: string };

export default async function Page() {
  const { data: plans, source } = await getTrainingPlans();

  const rows: Row[] = plans.map((p) => ({
    id: p.id,
    title: p.title,
    planYear: String(p.planYear),
    scope: p.roleCode ?? (p.departmentId ? "Department" : "All"),
    status: p.status,
  }));

  return (
    <>
      <PageHeader
        title="Training Plans"
        subtitle="Annual training plans assigned by department or role."
        back="/learning"
      />
      <div className="card">
        <div className="card-h">
          <h3>Annual plans</h3>
          <span style={{ color: "var(--ink2)", fontSize: "0.875rem" }}>
            {rows.length} plan{rows.length !== 1 ? "s" : ""}
          </span>
        </div>
        {source === "error" ? (
          <RefreshErrorState error={toHumanError("load", { area: "training plans" })} backHref="/learning" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="📋"
            title="No training plans yet"
            message="HR admins can create annual training plans to assign courses and classroom programmes to departments or roles."
          />
        ) : (
          <DataTable<Row>
            columns={[
              { key: "title", label: "Plan title" },
              { key: "planYear", label: "Year", align: "right" },
              { key: "scope", label: "Scope" },
              { key: "status", label: "Status", cellType: "status" },
            ]}
            rows={rows}
            sortable
            filterable
            filterPlaceholder="Search plans…"
            pageSize={15}
          />
        )}
      </div>
    </>
  );
}
