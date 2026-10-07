import { DataSourceBadge } from "../../../_components/DataSourceBadge";
import { PageHeader, EmptyState, RefreshErrorState, Card, DataTable } from "../../../_components/ds";
import { getProcurementAnnualPlans } from "../../../_data/loaders";
import { toHumanError } from "@/lib/messages";
import { fyLabel, currentFinancialYearStart } from "@/lib/financialYear";
import { PLAN_STATUS_LABELS } from "@/lib/procurementLabels";
import Link from "next/link";

// GAP-PROCUREMENT-PLANNING-01/02/03/04/05: the list used to fetch everything,
// print a UUID fragment as the "Plan ID", use an inline hand-coloured status
// span, mislabel the estimate as "Total budget", never show the item count, and
// make only the title clickable. It is now a filterable, paginated DataTable
// that passes year/department to the loader, shows the human planNo, an Items
// column, the shared StatusPill (via statusLabels) and formatMoney (cellType
// "amount", paise-exact), with the whole row linking to the plan detail.

type PlanRow = {
  id: string;
  planNo: string;
  fy: string;
  title: string;
  department: string;
  estimatedValueMinor: string;
  itemCount: number;
  status: string;
} & Record<string, unknown>;

export default async function AnnualProcurementPlanPage({
  searchParams,
}: {
  searchParams?: { year?: string; department?: string };
}) {
  const yearParam = searchParams?.year ? Number(searchParams.year) : undefined;
  const year = Number.isFinite(yearParam) ? yearParam : undefined;
  const department = searchParams?.department?.trim() || undefined;
  const hasFilter = year !== undefined || department !== undefined;

  const { data: plans, source } = await getProcurementAnnualPlans({ year, department });

  // A small FY range around the current financial year for the filter select.
  const currentFy = currentFinancialYearStart();
  const fyOptions: number[] = [];
  for (let y = currentFy + 1; y >= currentFy - 4; y--) fyOptions.push(y);

  const rows: PlanRow[] = (plans ?? []).map((plan) => ({
    id: plan.id,
    planNo: plan.planNo ?? "—",
    fy: fyLabel(plan.planYear),
    title: plan.title,
    department: plan.department,
    estimatedValueMinor: String(plan.totalEstimatedMinor),
    itemCount: plan.itemCount,
    status: plan.status,
  }));

  return (
    <>
      <PageHeader
        title="Annual Procurement Plans"
        subtitle="GFR 2017 — Ministry-level aggregated procurement intent"
        actions={
          <>
            {source === "error" ? <DataSourceBadge source={source} message="Couldn't load — showing nothing" /> : null}
            <Link href="/procurement/planning/new" className="btn primary">+ New Plan</Link>
          </>
        }
      />

      <Card title="Filter plans" padding>
        <form method="get" className="fields" style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div className="field">
            <label className="label" htmlFor="year">Financial year</label>
            <select id="year" name="year" className="inp" defaultValue={year !== undefined ? String(year) : ""}>
              <option value="">All years</option>
              {fyOptions.map((y) => (
                <option key={y} value={y}>{fyLabel(y)}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label className="label" htmlFor="department">Department</label>
            <input id="department" name="department" className="inp" defaultValue={department ?? ""} placeholder="e.g. Finance" />
          </div>
          <div className="field" style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }}>Apply</button>
            {hasFilter ? (
              <Link href="/procurement/planning" className="btn ghost" style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>Clear</Link>
            ) : null}
          </div>
        </form>
      </Card>

      {source === "error" ? (
        <RefreshErrorState error={toHumanError("load", { area: "procurement plans" })} />
      ) : rows.length === 0 ? (
        hasFilter ? (
          <EmptyState icon="🔍" title="No plans match this filter" message="No annual plans were found for the selected year/department. Clear the filter to see all plans." />
        ) : (
          <EmptyState icon="📋" title="No plans yet" message="Create an annual procurement plan to aggregate department-level demand for the financial year." />
        )
      ) : (
        <Card title="Annual plans">
          <DataTable<PlanRow>
            rows={rows}
            rowLinkKey="id"
            rowLinkPrefix="/procurement/planning/"
            identifyingColumnKey="planNo"
            sortable
            filterable
            filterPlaceholder="Filter by plan no, title, department…"
            pageSize={25}
            columns={[
              { key: "planNo", label: "Plan No" },
              { key: "fy", label: "Year" },
              { key: "title", label: "Title" },
              { key: "department", label: "Department" },
              { key: "estimatedValueMinor", label: "Estimated value", align: "right", cellType: "amount" },
              { key: "itemCount", label: "Items", align: "right" },
              { key: "status", label: "Status", cellType: "status", statusLabels: PLAN_STATUS_LABELS },
            ]}
          />
        </Card>
      )}
    </>
  );
}
