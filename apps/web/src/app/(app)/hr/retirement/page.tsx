/**
 * Retirement & Separation page — Sprint 14 / Lifecycle Phase 2
 * Top section: RetirementDashboard (card grid, next 6 months)
 * Middle: RetirementProcessWizard (interactive 5-step checklist)
 * Bottom: full register DataTable
 */
import { PageHeader, StatGrid, StatCard, Card, DataTable, RefreshErrorState } from "../../../_components/ds";
import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { fetchJson, type LoaderResult } from "@/app/_data/apiClient";
import type { RetirementRow } from "./_components/RetirementDashboard";
import { RetirementCaseWorkspace } from "./_components/RetirementCaseWorkspace";
import { toHumanError } from "@/lib/messages";

async function getData(): Promise<LoaderResult<RetirementRow[]>> {
  return fetchJson<unknown, RetirementRow[]>("/api/v1/hrms/retirements", [], {
    telemetryKey: "hr.retirement",
    mapResponse: (p) => {
      const arr = Array.isArray(p) ? p : (p as { data?: RetirementRow[] })?.data;
      return Array.isArray(arr) ? arr : null;
    },
  });
}

const COLUMNS: { key: keyof RetirementRow & string; label: string; cellType?: "status" }[] = [
  { key: "employee",          label: "Employee" },
  { key: "department",        label: "Department" },
  { key: "designation",       label: "Designation" },
  { key: "superannuationDate",label: "Retirement Date" },
  { key: "separationType",    label: "Type" },
  { key: "status",            label: "Status", cellType: "status" },
];

export default async function RetirementPage() {
  const { data: items, source } = await getData();
  const errored = source === "error";

  const cutoff6m  = new Date();
  cutoff6m.setMonth(cutoff6m.getMonth() + 6);
  const upcoming  = items.filter((i) => {
    if (!i.superannuationDate) return false;
    const d = new Date(i.superannuationDate);
    return d >= new Date() && d <= cutoff6m;
  }).length;
  const completed = items.filter((i) => i.status === "completed").length;
  const vrs       = items.filter((i) => i.separationType === "VRS").length;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Retirement & Separation"
        subtitle="Upcoming retirements within 6 months, processing wizard, and full separation register."
        back="/hr" backLabel="Back to HR"
      />
      <DataSourceBadge source={source} message="Couldn't load retirement records — showing nothing" />

      {/* KPI strip */}
      <StatGrid>
        <StatCard icon="👴" iconBg="#e6f0ff" label="Total"          value={errored ? null : items.length} />
        <StatCard icon="📅" iconBg="#fffbe6" label="Next 6 Months"  value={errored ? null : upcoming} />
        <StatCard icon="✅" iconBg="#e6f7f0" label="Processed"       value={errored ? null : completed} />
        <StatCard icon="📝" iconBg="#f5f5f5" label="VRS"            value={errored ? null : vrs} />
      </StatGrid>

      {/* Card grid + wizard, bound to the same selected retiree */}
      {!errored && <RetirementCaseWorkspace rows={items} />}

      {/* Full register */}
      <div style={{ marginTop: 16 }}>
        <Card title="Full Separation Register">
          {errored ? (
            <div className="pad">
              <RefreshErrorState error={toHumanError("load", { area: "retirement" })} backHref="/hr" />
            </div>
          ) : (
            <DataTable<RetirementRow>
              columns={COLUMNS}
              rows={items}
              sortable
              filterable
              filterPlaceholder="Filter by employee, department or date…"
              pageSize={15}
              emptyIcon="🎓"
              emptyTitle="No retirement or separation records"
              emptyMessage="Superannuation, VRS, and resignation records appear here."
            />
          )}
        </Card>
      </div>
    </main>
  );
}
